"""پیام‌های بانکی و پل پیامک — خواندن (فاز ۶) + نوشتن (فاز ۷).

خواندن:
- list_sms: همهٔ ستون‌ها، فیلتر اختیاری status، مرتب بر created_at نزولی
  (معادل list_sms(p_token, p_status) قدیمی).
- get_bridge: پل «فعال» عضو جاری (آخرین ساخته‌شده) یا None. برخلاف سایر خواندن‌ها
  این یک «عضو-محور» است (member_id)، نه صرفاً خانواده‌محور — عیناً مثل get_bridge
  قدیمی. RLS همچنان روی family_id اعمال است (پل‌های عضو در همان خانواده‌اند).

نوشتن — معادل add_sms_messages، set_sms_status و create_bridge قدیمی:
- add_sms_messages: درج دسته‌ای برای عضو جاری، شمارهٔ ردیف‌های واردشده را برمی‌گرداند
  (متن خالی نادیده؛ نوع فقط expense/income وگرنه NULL؛ status='pending').
- set_sms_status: تغییر وضعیت (pending/recorded/ignored)، NOT_FOUND اگر پیامک نباشد.
- create_bridge: غیرفعال‌کردن پل‌های فعال قبلی عضو و ساخت توکن تازه (۴۰ هگز).

مرز خانواده در لایهٔ اپ (فیلتر family_id) در کنار RLS.
"""

from __future__ import annotations

import secrets
import uuid
import hashlib
from datetime import datetime

from sqlalchemy import and_, or_, select, text
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.rls import apply_to_transaction, reset_current_family, set_current_family
from app.models.family import Member
from app.models.account import Account
from app.models.messaging import SmsBridge, SmsMessage
from app.schemas.data import SmsItem, SmsRecord
from app.models.transaction import Transaction
from app.services import transactions
from app.services import sms_settings as settings_service
from app.services.sms_parser import detect_bank, normalize_sms, parse_sms

_SMS_STATUS = {"pending", "recorded", "ignored"}
PARSER_VERSION = "deterministic-v2"


def _body(raw: str) -> str:
    return " ".join(normalize_sms(raw).split())


def _identity_lock(db: Session, family_id, member_id, raw: str) -> None:
    # Serialize this recipient's small SMS batches, including transport-ID replays
    # whose body changed. No account lock is held at this point.
    key = f"sms:{family_id}:{member_id}"
    digest = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": digest})


def _same_messages(db: Session, actor: Member, row: SmsMessage) -> list[SmsMessage]:
    # Legacy rows intentionally remain unchanged. Compare complete bodies, not amounts.
    candidates = db.scalars(select(SmsMessage).where(_own_sms(actor)).order_by(SmsMessage.created_at, SmsMessage.id))
    return [other for other in candidates if _body(other.raw_text) == _body(row.raw_text)
            and not (row.transport_id and other.transport_id and row.transport_id != other.transport_id)
            and not (row.sender and other.sender and settings_service.normalize_sender(row.sender) != settings_service.normalize_sender(other.sender))]


def _insert_unique(db: Session, actor: Member, row: SmsMessage) -> bool:
    _identity_lock(db, actor.family_id, actor.id, row.raw_text)
    if _same_messages(db, actor, row):
        return False
    row.identity_key = hashlib.sha256(("transport:" + row.transport_id if row.transport_id else
        "body:" + settings_service.normalize_sender(row.sender) + ":" + _body(row.raw_text)).encode()).hexdigest()
    if db.scalar(select(SmsMessage.id).where(SmsMessage.family_id == actor.family_id,
            SmsMessage.member_id == actor.id, SmsMessage.identity_key == row.identity_key)):
        return False
    db.add(row)
    db.flush()
    return True


def _own_sms(actor: Member):
    """Only the recipient may review messages; recover unassigned legacy rows for owner."""
    own_account = select(Account.id).where(
        Account.family_id == actor.family_id, Account.member_id == actor.id
    )
    legacy = and_(SmsMessage.member_id.is_(None), SmsMessage.account_id.in_(own_account))
    if actor.role == "owner":
        legacy = or_(legacy, and_(SmsMessage.member_id.is_(None), SmsMessage.account_id.is_(None)))
    return and_(SmsMessage.family_id == actor.family_id,
                or_(SmsMessage.member_id == actor.id, legacy))


def list_sms(
    db: Session, actor: Member, status: str | None = None
) -> list[SmsMessage]:
    stmt = select(SmsMessage).where(_own_sms(actor))
    if status is not None:
        stmt = stmt.where(SmsMessage.status == status)
    stmt = stmt.order_by(SmsMessage.created_at.desc())
    return list(db.execute(stmt).scalars())


def get_bridge(db: Session, member_id: uuid.UUID) -> SmsBridge | None:
    """پل فعال عضو جاری (آخرین)، یا None اگر پلی نساخته باشد."""
    return db.execute(
        select(SmsBridge)
        .where(SmsBridge.member_id == member_id, SmsBridge.active.is_(True))
        .order_by(SmsBridge.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


# ── نوشتن (فاز ۷) ────────────────────────────────────────────
def add_sms_messages(db: Session, actor: Member, items: list[SmsItem]) -> int:
    """درج دسته‌ای پیام‌های بانکی برای عضو جاری؛ شمارهٔ ردیف‌های واردشده را برمی‌گرداند.

    پیام‌های با متن خالی نادیده گرفته می‌شوند؛ نوع فقط اگر expense/income باشد نگه
    داشته می‌شود (وگرنه NULL، هم‌سان با CHECK جدول)؛ وضعیت اولیه pending است.
    """
    rows: list[SmsMessage] = []
    for it in items:
        raw = (it.raw_text or "").strip()
        if not raw:
            continue
        row = _row_from_raw(actor.family_id, actor.id, raw, it.sender, it.received_at, it.transport_id)
        if row is not None:
            rows.append(row)
    if not rows:
        return 0
    inserted = sum(_insert_unique(db, actor, row) for row in sorted(rows, key=lambda r: _body(r.raw_text)))
    db.commit()
    return inserted


def set_sms_status(
    db: Session, actor: Member, sms_id: uuid.UUID, status: str | None
) -> None:
    st = (status or "").strip()
    if st not in _SMS_STATUS:
        raise AppError("INVALID_STATUS", "وضعیت پیامک نامعتبر است.", 422)
    row = db.execute(
        select(SmsMessage).where(
            SmsMessage.id == sms_id, _own_sms(actor)
        ).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "پیامک یافت نشد.", 404)
    if row.status == "recorded" and st != "recorded" or st == "recorded" and row.status != "recorded":
        raise AppError("SMS_RECORD_REQUIRED", "ثبت پیامک باید همراه با پیوند تراکنش انجام شود.", 409)
    row.status = st
    db.commit()


def record_sms(db: Session, actor: Member, sms_id: uuid.UUID, req: SmsRecord) -> Transaction:
    row = db.scalar(select(SmsMessage).where(SmsMessage.id == sms_id, _own_sms(actor)))
    if row is None:
        raise AppError("NOT_FOUND", "پیامک یافت نشد.", 404)
    _identity_lock(db, actor.family_id, actor.id, row.raw_text)
    row = db.scalar(select(SmsMessage).where(SmsMessage.id == sms_id, _own_sms(actor))
                    .with_for_update().execution_options(populate_existing=True))
    aliases = _same_messages(db, actor, row)
    recorded = next((other for other in aliases if other.status == "recorded" and other.transaction_id), None)
    recorded = recorded or next((other for other in aliases if other.status == "recorded"), None)
    if recorded:
        transaction = db.scalar(select(Transaction).where(Transaction.id == recorded.transaction_id,
            Transaction.family_id == actor.family_id, Transaction.member_id == actor.id))
        if transaction is not None:
            if row.status == "pending":
                row.status = "recorded"
                db.commit()
            return transaction
        raise AppError("SMS_HISTORY_REVIEW", "این پیامک قبلاً ثبت شده است؛ سابقهٔ تراکنش‌ها را بررسی کنید.", 409)
    if row.status != "pending":
        raise AppError("SMS_NOT_PENDING", "این پیامک در انتظار ثبت نیست.", 409)
    if req.existing_transaction_id:
        # Recover an explicit v0.8.0 browser receipt, never infer a historical link.
        if row.parser_version is not None:
            raise AppError("SMS_HISTORY_REVIEW", "بازیابی رسید فقط برای پیامک‌های قدیمی است؛ سابقه را بررسی کنید.", 409)
        tx_id = transactions.to_uuid(req.existing_transaction_id, "NOT_FOUND", "تراکنش یافت نشد.", 404)
        transaction = db.scalar(select(Transaction).where(Transaction.id == tx_id,
            Transaction.family_id == actor.family_id, Transaction.member_id == actor.id).with_for_update())
        if transaction is None or transaction.source_kind is not None or transaction.type not in ("expense", "income"):
            raise AppError("SMS_HISTORY_REVIEW", "تراکنش قبلی پیدا نشد؛ سابقه را بررسی کنید.", 409)
        if db.scalar(select(SmsMessage.id).where(SmsMessage.transaction_id == tx_id)):
            raise AppError("SMS_HISTORY_REVIEW", "این تراکنش به پیامک دیگری پیوند دارد؛ سابقه را بررسی کنید.", 409)
    else:
        if req.transaction is None or req.transaction.type not in ("expense", "income") or req.transaction.repeat != "none":
            raise AppError("INVALID_TYPE", "اطلاعات تراکنش پیامک معتبر نیست.", 422)
        if req.transaction.member_id != str(actor.id) or not req.transaction.account_id:
            raise AppError("ACCOUNT_FORBIDDEN", "فقط حساب‌ها و کیف‌پول‌های خودتان قابل انتخاب‌اند.", 403)
        transaction = transactions.create_uncommitted(db, actor.family_id,
            req.transaction.model_copy(update={"require_available_balance": True}), actor=actor)
    row.transaction_id = transaction.id
    row.status = "recorded"
    db.commit()
    db.refresh(transaction)
    return transaction


def create_bridge(db: Session, actor: Member) -> str:
    """پل‌های فعال قبلی عضو را غیرفعال و پل تازه‌ای می‌سازد؛ توکن آن را برمی‌گرداند."""
    db.execute(
        sa_update(SmsBridge)
        .where(SmsBridge.member_id == actor.id, SmsBridge.active.is_(True))
        .values(active=False)
    )
    token = secrets.token_hex(20)  # ۴۰ رقم هگز — هم‌سان با create_bridge قدیمی
    db.add(
        SmsBridge(
            family_id=actor.family_id,
            member_id=actor.id,
            token=token,
            active=True,
        )
    )
    db.commit()
    return token


# ── دروازهٔ رضایت (بند ۱ و ۲۵) ───────────────────────────────
# قاعده: هیچ پیامکی که «خودکار» خوانده شده بدون رضایت صریح ذخیره نمی‌شود.
#
# این دروازه فقط روی دو مسیر خودکار است (ingest_sms از خوانندهٔ نیتیو، و
# ingest_via_bridge از فورواردر). مسیر دستی add_sms_messages عمداً از این
# دروازه رد نمی‌شود: وقتی کاربر خودش متنی را کپی و وارد می‌کند، همان کارْ
# رضایت است. اگر آنجا هم سد می‌گذاشتیم، کاربری که هیچ حسابی فعال نکرده
# نمی‌توانست حتی یک پیامک را دستی وارد کند.
#
# سه حالت خروجی برای هر پیامک:
#   • حسابِ یکتا پیدا شد   → account_id ست می‌شود.
#   • پذیرفته ولی مبهم     → account_id = NULL یعنی «نیازمند بررسی» (بند ۲۰).
#   • هیچ نشانه‌ای نبود    → اصلاً ذخیره نمی‌شود.
def _norm_bank(name: str | None) -> str:
    """نام بانک را برای «مقایسه» ساده می‌کند (نه برای نمایش).

    فقط پیشوند «بانک»، نیم‌فاصله و ی/ک عربی را یکدست می‌کند. عمداً هیچ واژهٔ
    معناداری حذف نمی‌شود: اگر «قرض الحسنه» را دور بریزیم، از نام پارسر چیزی
    باقی نمی‌ماند و همان موردی که این تابع برایش نوشته شده خراب می‌شود.
    """
    s = (name or "").strip()
    if not s:
        return ""
    s = s.replace("‌", " ").replace("‏", "").replace("‎", "")
    s = s.replace("ي", "ی").replace("ك", "ک")
    s = s.replace("بانک", " ").replace("موسسه", " ").replace("مؤسسه", " ")
    return " ".join(s.split())


# پارسر و فهرست بانک‌های فرانت پس از یکدست‌سازی ۲۳ نام از ۲۵ نام را مو‌به‌مو
# یکی می‌دهند. تنها اختلاف واقعی همین یکی است: پارسر «قرض‌الحسنه» و «مهر ایران»
# را دو بانک جدا می‌شناسد، ولی حساب کاربر «قرض‌الحسنه مهر ایران» ذخیره شده.
#
# این نگاشتِ صریح عمدی است و جایگزین «تطبیق دربرگیرنده» شد: با قاعدهٔ in،
# «صادرات» داخل «توسعه صادرات» می‌افتد و دو بانکِ واقعاً متفاوت یکی می‌شوند —
# یعنی پیامک به حساب اشتباه بچسبد. اینجا هر نام فقط با نام برابرِ خودش (یا
# مترادفِ فهرست‌شده) جفت می‌شود.
_BANK_ALIASES = {
    "قرض الحسنه": "قرض الحسنه مهر ایران",
    "مهر ایران": "قرض الحسنه مهر ایران",
}


def _canon_bank(name: str | None) -> str:
    n = _norm_bank(name)
    return _BANK_ALIASES.get(n, n)


def _bank_matches(parsed_bank: str | None, account_bank: str | None) -> bool:
    """تساویِ نامِ یکدست‌شده — نه دربرگیرندگی (دلیلش بالای _BANK_ALIASES)."""
    a, b = _canon_bank(parsed_bank), _canon_bank(account_bank)
    return bool(a) and bool(b) and a == b


def _resolve_account(
    db: Session,
    family_id: uuid.UUID,
    sender: str | None,
    parsed_bank: str | None,
) -> tuple[bool, uuid.UUID | None]:
    """(پذیرفته‌شود؟، شناسهٔ حساب) — قلبِ رضایت‌محوری.

    ترتیب عمدی است: اول فرستنده، بعد بانک. فرستنده نشانهٔ قوی‌تری است چون
    کاربر آن را صراحتاً به «همان حساب» بسته؛ نام بانک فقط از متن حدس زده
    می‌شود. ولی بند ۱۰ می‌گوید تشخیص نباید «فقط» به سرشماره تکیه کند، پس
    سرشمارهٔ ناشناس هم پایان کار نیست و بانک همچنان بررسی می‌شود.
    """
    enabled = settings_service.enabled_accounts(db, family_id)
    if not enabled:
        return (False, None)  # هیچ حسابی فعال نیست → هیچ چیز ذخیره نمی‌شود

    enabled_ids = {a.id for a in enabled}

    # ① فرستنده: فقط سرشماره‌هایی که به یک حسابِ فعال بسته شده‌اند
    norm = settings_service.normalize_sender(sender)
    if norm:
        matched = {
            s.account_id
            for s in settings_service.list_senders(db, family_id)
            if s.sender == norm and s.account_id in enabled_ids
        }
        if len(matched) == 1:
            return (True, next(iter(matched)))
        if matched:
            return (True, None)  # چند حساب همین سرشماره را دارند → مبهم

    # ② بانک: از متن پیامک، مقابلِ بانکِ حساب‌های فعال
    if parsed_bank:
        hits = [a.id for a in enabled if _bank_matches(parsed_bank, a.bank)]
        if len(hits) == 1:
            return (True, hits[0])
        if hits:
            return (True, None)  # چند حساب از همان بانک → کاربر تعیین کند

    return (False, None)


# ── ingest: پارس «سمت سرور» (فاز ۸) ──────────────────────────
# All paths now parse raw text on the server. Manual imports deliberately bypass
# automatic-reading consent; native and bridge ingestion retain the consent gate.
def _row_from_raw(
    family_id: uuid.UUID,
    member_id: uuid.UUID | None,
    raw_text: str | None,
    sender: str | None,
    received_at: datetime | None = None,
    transport_id: str | None = None,
) -> SmsMessage | None:
    """متن خام → ردیف SmsMessage (pending) با فیلدهای پارس‌شده؛ یا None اگر متن خالی.

    raw_text «اصل» (فقط trim‌شده) ذخیره می‌شود تا کاربر متن واقعی را ببیند؛ پارس روی
    نسخهٔ نرمال انجام می‌شود. اگر بانک از متن پیدا نشد و فرستنده داده شده بود، به‌عنوان
    کمکی از روی نام فرستنده هم تلاش می‌کنیم (بهبود نسبت به webhook قدیمی که نام
    فرستنده را خام در ستون bank می‌ریخت).
    """
    raw = (raw_text or "").strip()
    if not raw:
        return None
    parsed = parse_sms(raw)
    if parsed is None:
        return None
    bank = parsed.bank
    if bank is None and sender:
        bank = detect_bank(normalize_sms(sender))
    return SmsMessage(
        family_id=family_id,
        member_id=member_id,
        raw_text=raw,
        bank=bank,
        type=parsed.type,  # پارسر تضمین می‌کند expense/income/None
        amount=parsed.amount,
        balance=parsed.balance,
        date=parsed.date,
        time=parsed.time,
        received_at=received_at if received_at and received_at.tzinfo else None,
        transport_id=(transport_id or "").strip() or None,
        parser_version=PARSER_VERSION,
        status="pending",
        # فرستنده «همان‌طور که آمده» ذخیره می‌شود تا کاربر در فهرست ببیند
        # پیامک از کجاست و بتواند از رویش سرشمارهٔ مجاز بسازد (بند ۱۰).
        # مقایسه‌ها روی نسخهٔ نرمال انجام می‌شود، نه روی این.
        sender=(sender or "").strip() or None,
    )


# ── بند ۱۰/۸: «سرشماره به‌تنهایی کافی نیست» ──────────────────
# مسیرهای خودکار (خوانندهٔ نیتیو + پل) پیامک را فقط وقتی ذخیره می‌کنند که
# «هم مبلغ و هم نوع» از متن درآمده باشد. چرا هر دو؟
#   • پیامک تبلیغاتی معمولاً نه مبلغِ بزرگ دارد نه واژهٔ واریز/برداشت → هر دو None.
#   • پیامک رمزِ یک‌بارمصرف (OTP) کدی مثل ۴۵۸۲۱۹ دارد که پارسر آن را «مبلغ»
#     می‌بیند، ولی واژهٔ جهت ندارد → type None. پس فقط شرطِ «مبلغ» جلوی OTP را
#     نمی‌گیرد؛ باید نوع هم باشد.
# با این قاعده، تطبیقِ صِرفِ سرشماره هرگز به‌تنهایی چیزی ذخیره نمی‌کند (بند ۱۰):
# سرشماره تعیین می‌کند پیامک «به کدام حساب» است، ولی محتوای پارس‌شده تعیین می‌کند
# که «اصلاً تراکنش هست یا نه».
#
# بها: تراکنشِ واقعی با جهتِ مبهم (مثلاً «کارت به کارت» بی‌واژهٔ واریز/برداشت)
# در مسیر خودکار رد می‌شود. این آگاهانه است: بی‌نوع نمی‌توان درست ثبتش کرد، و
# کاربر می‌تواند همان متن را دستی جای‌گذاری کند (مسیر دستی از این دروازه رد
# نمی‌شود چون جای‌گذاری خودش رضایت + بازبینی است).
def _is_transaction(row: SmsMessage) -> bool:
    """آیا این ردیفِ پارس‌شده نامزدِ یک تراکنش است؟ (مبلغ و نوع، هر دو)."""
    return row.amount is not None and row.type is not None


def ingest_sms(
    db: Session, actor: Member, items: list[tuple]
) -> list[SmsMessage]:
    """درج دسته‌ای پیامک‌های «خام» برای عضو جاری با پارس سمت‌سرور.

    items فهرستی از (raw_text, sender) است. ردیف‌های واردشده را برمی‌گرداند (برای
    نمایش فوری در کلاینت، بدون نیاز به fetch دوباره). مسیر نشست‌محور (RLS فعال).

    این مسیر «خودکار» است (خوانندهٔ نیتیو)، پس از دروازهٔ رضایت رد می‌شود: اگر
    کاربر هیچ حسابی را فعال نکرده باشد، خروجی خالی است و هیچ ردیفی ذخیره
    نمی‌شود — حتی اگر متن کاملاً یک پیامک بانکی معتبر باشد.
    """
    rows: list[SmsMessage] = []
    for item in items:
        raw_text, sender, *metadata = item
        row = _row_from_raw(actor.family_id, actor.id, raw_text, sender, *metadata)
        if row is None:
            continue
        # بند ۱۰/۸: پیامکِ بی‌مبلغ یا بی‌نوع (تبلیغ/OTP) ذخیره نمی‌شود
        if not _is_transaction(row):
            continue
        accept, account_id = _resolve_account(
            db, actor.family_id, sender, row.bank
        )
        if not accept:
            continue
        row.account_id = account_id
        rows.append(row)
    if not rows:
        return []
    rows = [row for row in sorted(rows, key=lambda r: _body(r.raw_text)) if _insert_unique(db, actor, row)]
    db.commit()
    for r in rows:
        db.refresh(r)
    return rows


def ingest_via_bridge(
    db: Session, token: str | None, text: str | None, sender: str | None = None,
    received_at: datetime | None = None, transport_id: str | None = None,
) -> int:
    """webhook پل (جایگزین api/sms-webhook.js): توکن → خانواده/عضو → پارس و درج.

    احراز با «توکن پل» است، نه نشست کاربر؛ پس این مسیر get_tenant_member ندارد و
    زمینهٔ RLS را «دستی» ست می‌کند. ابتدا ردیف پل با توکن خوانده می‌شود (جدول
    sms_bridges پس از مهاجرت 0003 بیرون از RLS است تا این خواندن پیش-از-زمینه ممکن
    باشد)، سپس زمینهٔ خانواده ست و پیامک در sms_messages (که هنوز زیر RLS است) درج
    می‌شود. تعداد واردشده (۰ یا ۱) را برمی‌گرداند.
    """
    tok = (token or "").strip()
    if not tok:
        raise AppError("UNAUTHORIZED", "توکن پل ارسال نشده است.", 401)
    bridge = db.execute(
        select(SmsBridge).where(SmsBridge.token == tok, SmsBridge.active.is_(True))
    ).scalar_one_or_none()
    if bridge is None:
        raise AppError("UNAUTHORIZED", "توکن پل نامعتبر است.", 401)

    ctx = set_current_family(bridge.family_id)
    try:
        apply_to_transaction(db)  # زمینهٔ خانواده روی همین تراکنش باز
        row = _row_from_raw(bridge.family_id, bridge.member_id, text, sender, received_at, transport_id)
        if row is None:
            return 0
        # بند ۱۰/۸: پیامکِ بی‌مبلغ یا بی‌نوع (تبلیغ/OTP) ذخیره نمی‌شود
        if not _is_transaction(row):
            return 0
        # همان دروازهٔ رضایتِ مسیر نیتیو. اگر اینجا نبود، کاربری که پل را
        # قبلاً ساخته بی‌آنکه حسابی فعال کند، باز هم همهٔ پیامک‌هایش ذخیره
        # می‌شد — یعنی یک درِ پشتی به همان رفتاری که داریم می‌بندیم.
        accept, account_id = _resolve_account(
            db, bridge.family_id, sender, row.bank
        )
        if not accept:
            return 0
        row.account_id = account_id
        recipient = db.scalar(select(Member).where(Member.id == bridge.member_id, Member.family_id == bridge.family_id))
        if recipient is None or not _insert_unique(db, recipient, row):
            return 0
        db.commit()
        return 1
    finally:
        reset_current_family(ctx)
