"""§۷ — ترجیحاتِ اعلان و «نادیده گرفتم».

این سرویس **اعلان نمی‌سازد**. اعلان‌ها مشتق‌شده‌اند و در مرزِ کلاینت ساخته
می‌شوند (`src/domain/notification/notification.rules.ts`)؛ دلیلش در یادداشتِ
تاریخ‌دارِ زیرِ §7.1 در `docs/master-prompt.md` است. کارِ این‌جا فقط نگه‌داشتنِ
دو چیزِ ماندگار است: ترجیحِ کاربر، و اینکه چه چیزی را نادیده گرفته.

⚠️ **هر چهار مسیر زمینهٔ RLS می‌خواهند.** وسوسه این بود که `prefs` را
بی‌زمینه سرو کنیم چون ترجیحات ستونِ `members` است و آن جدول از RLS مستثناست؛
ولی `get_prefs` فهرستِ نادیده‌گرفته‌ها را هم برمی‌گرداند و آن جدول زیرِ RLS +
FORCE است. بی‌بستنِ `app.family_id`، محمولِ fail-closed صفر ردیف می‌دهد و
`dismissed` **همیشه خالی** برمی‌گردد — بی هیچ خطایی. معیار «این مفهوم در کدام
جدول است» نیست، «این درخواست به کدام جدول‌ها دست می‌زند» است.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.family import Member
from app.models.notification import NotificationDismissal
from app.schemas.data import NotificationPrefsOut, NotificationPrefsUpdate

# همان دامنه‌های فعالِ §۷.۱. فهرستِ بسته است تا کلیدِ بی‌معنی در JSONB نرود؛
# با هر ماژولِ تازه یک عضو این‌جا اضافه می‌شود (و در notification.types.ts).
_DOMAINS = ("recurring", "bills", "event", "membership", "inventory")

# باید با MAX_LEAD_DAYS در src/domain/notification/notification.types.ts یکی
# بماند. اگر یکی عوض شد و دیگری نه، بدترین حالت این است که سرور عددی را
# بپذیرد که کلاینت خودش می‌بُرد — یعنی fail-safe، نه خرابی.
_MAX_LEAD_DAYS = 60

# هرسِ نادیده‌گرفته‌های کهنه. بی‌خطر بودنش از ساختِ کلید می‌آید: کلید تاریخ را
# در خود دارد (`event:<id>:<YYYY-MM-DD>`) و اعلان فقط داخلِ بازهٔ پیش‌هنگام
# دیده می‌شود، پس ردیفی که تاریخش گذشته دیگر هیچ‌وقت تطبیق نمی‌کند — حتی
# تولدِ سالِ بعد، چون کلیدش تاریخِ دیگری دارد. سقفِ پیش‌هنگام ۶۰ روز است، پس
# ۱۸۰ روز حاشیهٔ سه‌برابری دارد.
_PRUNE_AFTER_DAYS = 180

# سقفِ دفاعیِ طولِ کلید — کلیدهای واقعی حدودِ ۵۰ نویسه‌اند
# ("event:" + uuid 36 + ":" + 10). بی این سقف، کلاینتِ خراب می‌توانست ردیفی
# با متنِ چندمگابایتی بنویسد.
_MAX_KEY_LEN = 200


def _clean_lead(value: object) -> int | None:
    """عددِ پیش‌هنگامِ سالم، یا None اگر اصلاً عدد نباشد.

    bool عمداً رد می‌شود: در پایتون `True` یک `int` است، پس بی این بررسی
    `{"event": true}` بی‌صدا به «یک روز» ترجمه می‌شد.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return max(0, min(_MAX_LEAD_DAYS, value))


def get_prefs(db: Session, actor: Member) -> NotificationPrefsOut:
    """ترجیحاتِ این عضو + فهرستِ نادیده‌گرفته‌ها در یک پاسخ."""
    raw = actor.notif_prefs or {}
    domains_raw = raw.get("domains") or {}
    leads_raw = raw.get("leadDays") or {}

    domains: dict[str, bool] = {}
    lead_days: dict[str, int] = {}
    for d in _DOMAINS:
        # فقط مقدارِ صریحِ False خاموش است. کلیدِ غایب «روشن» می‌ماند —
        # همان قاعدهٔ کلاینت: سکوتِ پیش‌فرض باگی است که کسی گزارش نمی‌کند.
        if d in domains_raw:
            domains[d] = bool(domains_raw[d])
        cleaned = _clean_lead(leads_raw.get(d))
        if cleaned is not None:
            lead_days[d] = cleaned

    keys = list(
        db.execute(
            select(NotificationDismissal.key).where(
                NotificationDismissal.member_id == actor.id
            )
        ).scalars()
    )
    return NotificationPrefsOut(
        enabled=bool(actor.notif_enabled),
        domains=domains,
        lead_days=lead_days,
        dismissed=keys,
    )


def update_prefs(
    db: Session, actor: Member, body: NotificationPrefsUpdate
) -> NotificationPrefsOut:
    """به‌روزرسانیِ جزئی. `None` یعنی «دست نزن»، نه «خالی کن»."""
    if body.enabled is not None:
        actor.notif_enabled = body.enabled

    if body.domains is not None or body.lead_days is not None:
        # کپیِ تازه می‌سازیم نه جهشِ درجا: SQLAlchemy تغییرِ درونیِ dict را
        # روی ستونِ JSONB ردیابی نمی‌کند و commit بی‌صدا هیچ نمی‌نوشت.
        current = dict(actor.notif_prefs or {})
        if body.domains is not None:
            merged = dict(current.get("domains") or {})
            for key, value in body.domains.items():
                if key not in _DOMAINS:
                    raise AppError("INVALID_INPUT", "دامنهٔ اعلان نامعتبر است.", 422)
                merged[key] = bool(value)
            current["domains"] = merged
        if body.lead_days is not None:
            merged_lead = dict(current.get("leadDays") or {})
            for key, value in body.lead_days.items():
                if key not in _DOMAINS:
                    raise AppError("INVALID_INPUT", "دامنهٔ اعلان نامعتبر است.", 422)
                cleaned = _clean_lead(value)
                if cleaned is None:
                    raise AppError("INVALID_INPUT", "زمان پیش‌هنگام نامعتبر است.", 422)
                merged_lead[key] = cleaned
            current["leadDays"] = merged_lead
        actor.notif_prefs = current

    db.commit()
    db.refresh(actor)
    return get_prefs(db, actor)


def dismiss(db: Session, actor: Member, key: str) -> None:
    """ثبتِ «نادیده گرفتم» — بی‌خطر در برابرِ تکرار.

    دو بار زدنِ همان دکمه نباید خطا بدهد، پس ON CONFLICT DO NOTHING روی
    کلیدِ یکتای (member_id, key). اگر با SELECT-سپس-INSERT نوشته می‌شد، دو
    لمسِ سریع می‌توانست به نقضِ قیدِ یکتایی برسد.
    """
    k = (key or "").strip()
    if not k or len(k) > _MAX_KEY_LEN:
        raise AppError("INVALID_INPUT", "شناسهٔ اعلان نامعتبر است.", 422)

    db.execute(
        pg_insert(NotificationDismissal)
        .values(family_id=actor.family_id, member_id=actor.id, key=k)
        .on_conflict_do_nothing(constraint="uq_dismissal_member_key")
    )
    # هرسِ وزنِ مرده — دلیلِ بی‌خطر بودنش بالای فایل.
    db.execute(
        delete(NotificationDismissal).where(
            NotificationDismissal.member_id == actor.id,
            NotificationDismissal.created_at
            < func.now() - timedelta(days=_PRUNE_AFTER_DAYS),
        )
    )
    db.commit()


def undismiss(db: Session, actor: Member, key: str) -> None:
    """برگرداندنِ یک موردِ نادیده‌گرفته‌شده — بی‌خطر اگر وجود نداشته باشد."""
    db.execute(
        delete(NotificationDismissal).where(
            NotificationDismissal.member_id == actor.id,
            NotificationDismissal.key == (key or "").strip(),
        )
    )
    db.commit()
