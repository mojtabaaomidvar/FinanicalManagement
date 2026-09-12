"""دارایی‌های بازاری: ثبتِ مقدار + ارزش‌گذاری با قیمتِ روز.

تفاوتِ بنیادی با accounts: آن‌جا مبلغ ذخیره می‌شود، این‌جا فقط مقدار. «۲ سکه»
همیشه ۲ سکه است ولی ارزشش هر روز فرق می‌کند، پس ارزش هنگام خواندن حساب
می‌شود نه هنگام نوشتن. نتیجه‌اش این است که کاربر هیچ‌وقت لازم نیست دارایی‌اش
را «به‌روز» کند.

قیمت از services/market می‌آید و هیچ درخواستِ تازه‌ای به بالادست اضافه
نمی‌کند (همان کشِ اسنپ‌شات/نمادها). اگر نمادی قیمت نداشت، ردیف با
priced=false برمی‌گردد و در جمع نمی‌آید — عمداً صفر خاموش نمی‌گذاریم، چون
«۰ تومان» و «قیمت نداریم» دو چیزِ کاملاً متفاوت‌اند و اولی کاربر را
می‌ترساند.

مجوزها عیناً مثل accounts: مدیر (owner) روی هر ردیفِ خانواده، عضو فقط روی
ردیفِ خودش.
"""

from __future__ import annotations

import uuid
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.family import Member
from app.models.holding import Holding
from app.schemas.data import HoldingCreate, HoldingListOut, HoldingOut, HoldingUpdate
from app.services import market as market_service

_KINDS = ("gold", "currency", "crypto", "stock")
# سقفِ مقدار — هم‌ارزِ ستونِ Numeric(18,6): ۱۲ رقمِ صحیح.
_MAX_QUANTITY = Decimal("999999999999")
_QUANTIZE = Decimal("0.000001")   # شش رقمِ اعشار، هم‌سان با ستون


# ── اعتبارسنجی ──────────────────────────────────────────────
def _valid_kind(raw: str | None) -> str:
    kind = (raw or "").strip()
    if kind not in _KINDS:
        # کد عمداً INVALID_KIND نیست: آن کد در کلاینت به دامنهٔ «حساب» نگاشته
        # شده («نوع حساب معتبر نیست») و استفادهٔ دوباره‌اش این‌جا پیامِ اشتباهِ
        # دامنهٔ دیگری را به کاربر نشان می‌داد.
        raise AppError("INVALID_HOLDING_KIND", "نوعِ دارایی نامعتبر است.", 422)
    return kind


def _valid_text(raw: str | None, code: str, msg: str, limit: int = 80) -> str:
    t = (raw or "").strip()
    if not t or len(t) > limit:
        raise AppError(code, msg, 422)
    return t


def _valid_quantity(raw: Decimal | None) -> Decimal:
    """مقدار باید مثبت و در بازهٔ ستون باشد.

    گِردکردن به شش رقم عمدی است: اگر کلاینت عددِ درازتری بفرستد، Postgres
    خودش گِرد می‌کند ولی ما پیش از CHECK این کار را می‌کنیم تا «۰٫۰۰۰۰۰۰۱»
    به صفر گِرد نشود و بعد CHECKِ quantity > 0 با خطای مبهمِ دیتابیس بترکد.
    """
    if raw is None:
        raise AppError("INVALID_QUANTITY", "مقدار را وارد کنید.", 422)
    try:
        q = Decimal(raw).quantize(_QUANTIZE)
    except (InvalidOperation, ValueError):
        raise AppError("INVALID_QUANTITY", "مقدار نامعتبر است.", 422) from None
    if q <= 0:
        raise AppError("INVALID_QUANTITY", "مقدار باید بیشتر از صفر باشد.", 422)
    if q > _MAX_QUANTITY:
        raise AppError("INVALID_QUANTITY", "مقدار بیش از حدِ مجاز است.", 422)
    return q


# ── خواندن + ارزش‌گذاری ─────────────────────────────────────
def list_for_family(db: Session, family_id: uuid.UUID) -> list[Holding]:
    return list(
        db.execute(
            select(Holding)
            .where(Holding.family_id == family_id)
            .order_by(Holding.created_at.asc())
        ).scalars()
    )


def valued_list(db: Session, family_id: uuid.UUID) -> HoldingListOut:
    """فهرستِ دارایی‌ها + قیمتِ امروز + جمعِ ارزش."""
    rows = list_for_family(db, family_id)
    if not rows:
        return HoldingListOut(items=[], total=0.0, unpriced=0, stale=False)

    # فقط دسته‌هایی که واقعاً ردیف دارند بار می‌شوند.
    index, stale = market_service.price_lookup({r.kind for r in rows})

    items: list[HoldingOut] = []
    total = 0.0
    unpriced = 0
    for r in rows:
        hit = index.get(market_service.price_key(r.kind, r.symbol)) or index.get(
            market_service.price_key(r.kind, "", r.name)
        )
        if hit is None or hit[0] <= 0:
            unpriced += 1
            items.append(HoldingOut.of(r, 0.0, False))
            continue
        price, unit = hit
        out = HoldingOut.of(r, price, True, unit)
        total += out.value
        items.append(out)

    return HoldingListOut(items=items, total=total, unpriced=unpriced, stale=stale)


# ── افزودن / ویرایش / حذف ───────────────────────────────────
def create(db: Session, actor: Member, req: HoldingCreate) -> Holding:
    kind = _valid_kind(req.kind)
    name = _valid_text(req.name, "INVALID_NAME", "نامِ دارایی نامعتبر است.")
    # نماد اختیاری است: بعضی اقلامِ طلا/سکه در بالادست نماد ندارند و نام
    # تنها کلیدِ پایدارشان است. در آن حالت نام نقشِ نماد را می‌گیرد.
    symbol = (req.symbol or "").strip()[:40] or name
    quantity = _valid_quantity(req.quantity)

    row = Holding(
        family_id=actor.family_id,
        member_id=actor.id,
        kind=kind,
        symbol=symbol,
        name=name,
        unit=(req.unit or "").strip()[:20],
        quantity=quantity,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _own(db: Session, actor: Member, holding_id: uuid.UUID) -> Holding:
    """ردیف + بررسیِ مجوز در یک مرحله (مدیر هر ردیف / عضو ردیفِ خودش)."""
    stmt = select(Holding).where(
        Holding.id == holding_id, Holding.family_id == actor.family_id
    )
    if actor.role != "owner":
        stmt = stmt.where(Holding.member_id == actor.id)
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "دارایی یافت نشد.", 404)
    return row


def update(db: Session, actor: Member, holding_id: uuid.UUID, req: HoldingUpdate) -> Holding:
    row = _own(db, actor, holding_id)
    row.quantity = _valid_quantity(req.quantity)
    db.commit()
    db.refresh(row)
    return row


def delete(db: Session, actor: Member, holding_id: uuid.UUID) -> None:
    row = _own(db, actor, holding_id)
    db.delete(row)
    db.commit()
