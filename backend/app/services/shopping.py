"""§۱.۸ لیست خرید — سرویس.

تصمیم‌های معماری در `alembic/versions/0011_shopping.py` مستند است. آن‌چه
هنگامِ خواندنِ این فایل باید در ذهن باشد:

**۱) حالتِ قلم فقط با کنش عوض می‌شود، نه با PATCH.** `ShoppingItemWrite`
نه `checked` دارد نه `bought_at`. همان قاعدهٔ `BillWrite`: وگرنه کلاینت
می‌توانست قلم را «خریده‌شده» بنویسد بی‌آنکه خرجی ثبت شود یا موجودیِ انبار
بالا برود.

**۲) بستنِ سفرِ خرید یک commit است، نه سه.** تراکنشِ هزینه
(`transactions.create_uncommitted`) + مهرِ خرید روی اقلام + بالا رفتنِ
موجودیِ انبار (`inventory.bump_uncommitted`) همگی در **یک** commit
می‌نشینند. با چند commit، شکستِ میانی یا هزینهٔ یتیم می‌ساخت یا انبارِ
پرشده‌ای که خریدش ثبت نشده.

**۳) «سفرِ خرید» جدولِ جدا ندارد.** اقلامِ یک سفر همگی یک
`transaction_id` می‌گیرند، پس سفر از روی همان بازسازی می‌شود. جدولِ
چهارم فقط برای چیزی لازم بود که از این پیوند درنمی‌آید.

**۴) اقلامِ خریده‌شده حذف نمی‌شوند ولی در پاسخ هم نمی‌آیند.** ردیفشان
سابقه و پیوندِ تراکنش است؛ لیستِ خرید جایِ «چه بخریم» است نه آرشیو.

**۵) تکراری‌بودنِ عنوان در یک لیست رد می‌شود — ولی قیدِ دیتابیس ندارد.**
همهٔ تغییرهای اقلام، از جمله مسیر آفلاین و افزودن گروهی، ابتدا لیستِ
والد را قفل می‌کنند؛ پس دو عضو نمی‌توانند هم‌زمان «شیر» را اضافه کنند
یا عنوانی را به آن تغییر دهند. بررسیِ عنوان پس از گرفتن همین قفل است.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.feature_policy import require_feature
from app.models.family import Member
from app.models.shopping import InventoryItem, ShoppingItem, ShoppingList
from app.models.shopping_sync import ShoppingSyncReceipt
from app.schemas.data import (
    ShoppingItemOut,
    ShoppingItemWrite,
    ShoppingListOut,
    ShoppingListWrite,
    TransactionWrite,
    TripComplete,
    TripResult,
)
from app.schemas.shopping_batch import (
    ShoppingBatchAdded,
    ShoppingBatchRequest,
    ShoppingBatchResult,
    ShoppingBatchSkipped,
)
from app.services import inventory as inventory_service
from app.services import transactions as tx_service
from app.services.clock import utcnow
from app.services.common import to_uuid

# دستهٔ تراکنشی که خرجِ سفرِ خرید در آن می‌نشیند. عضوِ `_FIXED_CATEGORIES`
# در services/transactions.py است — اگر آن‌جا عوض شود این‌جا هم باید عوض
# شود، و تستِ بستنِ سفر همان را می‌گیرد.
_SHOPPING_CATEGORY = "shopping"

_MAX_NOTE = 500
_MAX_UNIT = 20
# سقف‌ها سخت‌گیرانه نیستند، فقط جلوی لیستِ بی‌انتها را می‌گیرند.
_MAX_LISTS = 50
_MAX_ITEMS = 500


# ── تبدیل به خروجی ───────────────────────────────────────────
def _item_out(row: ShoppingItem) -> ShoppingItemOut:
    return ShoppingItemOut(
        id=str(row.id),
        list_id=str(row.list_id),
        title=row.title,
        qty=row.qty,
        unit=row.unit,
        price=row.price,
        checked=row.checked,
        bought_at=row.bought_at,
        bought_by_member_id=(
            str(row.bought_by_member_id) if row.bought_by_member_id else None
        ),
        transaction_id=str(row.transaction_id) if row.transaction_id else None,
        inventory_item_id=(
            str(row.inventory_item_id) if row.inventory_item_id else None
        ),
        note=row.note,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
    )


def _sort_items(rows: list[ShoppingItem]) -> list[ShoppingItem]:
    """نخریده‌ها بالا، تیک‌خورده‌ها پایین — هر گروه به‌ترتیبِ افزودن.

    ترتیب در سرور تعیین می‌شود نه در UI (همان قاعدهٔ `services/bills.py`)
    و در پایتون است نه `ORDER BY` (همان دلیلِ `services/events.py`:
    SQLAlchemy در محیطِ وارسیِ من نصب نیست).
    """
    return sorted(rows, key=lambda r: (r.checked, r.created_at, str(r.id)))


def _list_out(row: ShoppingList, items: list[ShoppingItem]) -> ShoppingListOut:
    return ShoppingListOut(
        id=str(row.id),
        title=row.title,
        created_by=str(row.created_by) if row.created_by else None,
        created_at=row.created_at,
        items=[_item_out(i) for i in _sort_items(items)],
    )


# ── واکشیِ مرزدار ────────────────────────────────────────────
def _get_list(db: Session, actor: Member, list_id: uuid.UUID) -> ShoppingList:
    """لیستِ همین خانواده، وگرنه ۴۰۴.

    شرطِ `family_id` در لایهٔ اپ هم هست، هرچند RLS خودش ردیف را نمی‌دهد:
    اگر روزی وابستگیِ مسیر اشتباهاً `get_current_member` شود، این شرط مرز
    را نگه می‌دارد. (همان درسِ §۷.)
    """
    row = db.execute(
        select(ShoppingList)
        .where(
            ShoppingList.id == list_id,
            ShoppingList.family_id == actor.family_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "لیست خرید یافت نشد.", 404)
    return row


def _get_item(db: Session, actor: Member, item_id: uuid.UUID) -> ShoppingItem:
    # Read only the immutable parent id before locking. Every item mutation
    # takes the parent first, including offline writes and checkout, so title
    # checks cannot race and parent revision triggers cannot invert lock order.
    list_id = db.scalar(
        select(ShoppingItem.list_id).where(
            ShoppingItem.id == item_id,
            ShoppingItem.family_id == actor.family_id,
        )
    )
    if list_id is None:
        raise AppError("NOT_FOUND", "قلم لیست یافت نشد.", 404)
    _get_list(db, actor, list_id)
    row = db.execute(
        select(ShoppingItem)
        .where(
            ShoppingItem.id == item_id,
            ShoppingItem.family_id == actor.family_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "قلم لیست یافت نشد.", 404)
    return row


def _pending_of(db: Session, actor: Member, list_id: uuid.UUID) -> list[ShoppingItem]:
    return list(
        db.execute(
            select(ShoppingItem)
            .where(
                ShoppingItem.family_id == actor.family_id,
                ShoppingItem.list_id == list_id,
                ShoppingItem.bought_at.is_(None),
            )
            .execution_options(populate_existing=True)
        ).scalars()
    )


# ── خواندن ───────────────────────────────────────────────────
def list_for_family(db: Session, actor: Member) -> list[ShoppingListOut]:
    """همهٔ لیست‌ها، هرکدام با اقلامِ **نخریده‌اش**.

    اقلام در **یک** کوئری برای کلِ خانواده خوانده و در پایتون گروه
    می‌شوند، نه یک کوئری به‌ازای هر لیست: فهرستِ لیست‌ها در بوتِ
    نرم‌افزار خوانده می‌شود و N+1 همان‌جا دیده می‌شد.
    """
    lists = list(
        db.execute(
            select(ShoppingList)
            .where(ShoppingList.family_id == actor.family_id)
            .order_by(ShoppingList.created_at.asc())
        ).scalars()
    )
    if not lists:
        return []

    items = list(
        db.execute(
            select(ShoppingItem).where(
                ShoppingItem.family_id == actor.family_id,
                ShoppingItem.bought_at.is_(None),
            )
        ).scalars()
    )
    grouped: dict[uuid.UUID, list[ShoppingItem]] = {row.id: [] for row in lists}
    for item in items:
        bucket = grouped.get(item.list_id)
        if bucket is not None:
            bucket.append(item)

    return [_list_out(row, grouped[row.id]) for row in lists]


# ── لیست‌ها ──────────────────────────────────────────────────
def create_list_row(db: Session, actor: Member, req: ShoppingListWrite) -> ShoppingList:
    require_feature("shopping", write=True)
    title = inventory_service.clean_title(req.title, "نام لیست")
    count = len(
        list(
            db.execute(
                select(ShoppingList.id).where(
                    ShoppingList.family_id == actor.family_id
                )
            ).scalars()
        )
    )
    if count >= _MAX_LISTS:
        raise AppError("LIMIT_REACHED", "تعداد لیست‌ها به سقف رسیده است.", 409)
    row = ShoppingList(family_id=actor.family_id, created_by=actor.id, title=title)
    db.add(row)
    return row


def create_list(db: Session, actor: Member, req: ShoppingListWrite) -> ShoppingListOut:
    row = create_list_row(db, actor, req)
    db.commit()
    db.refresh(row)
    return _list_out(row, [])


def update_list(
    db: Session, actor: Member, list_id: uuid.UUID, req: ShoppingListWrite
) -> ShoppingListOut:
    row = _get_list(db, actor, list_id)
    row.title = inventory_service.clean_title(req.title, "نام لیست")
    db.commit()
    db.refresh(row)
    return _list_out(row, _pending_of(db, actor, row.id))


def delete_list(db: Session, actor: Member, list_id: uuid.UUID) -> None:
    """حذفِ لیست — اقلامش با CASCADE می‌روند، از جمله خریده‌شده‌ها.

    تراکنش‌های مالیِ ساخته‌شده **نمی‌روند**: پیوندشان از سمتِ قلم بود و
    خودِ خرج در گزارش‌ها سرِ جایش می‌ماند. همان فلسفهٔ `SET NULL`ِ قبوض،
    از آن سو.
    """
    row = _get_list(db, actor, list_id)
    db.delete(row)
    db.commit()


# ── اقلام ────────────────────────────────────────────────────
def _resolve_inventory(
    db: Session, actor: Member, raw: str | None
) -> InventoryItem | None:
    if raw is None or raw == "":
        return None
    item_id = inventory_service.inventory_uuid(raw)
    row = db.execute(
        select(InventoryItem).where(
            InventoryItem.id == item_id,
            InventoryItem.family_id == actor.family_id,
        )
    ).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "قلم انبار یافت نشد.", 404)
    return row


def _prepare_item(db: Session, actor: Member, req: ShoppingItemWrite) -> dict:
    linked = _resolve_inventory(db, actor, req.inventory_item_id)
    unit = inventory_service.clean_opt_text(req.unit, _MAX_UNIT, "واحد")
    # واحد از انبار به ارث می‌رسد اگر کاربر چیزی نگفته باشد — همان قلم
    # است، و دو واحدِ متفاوت برای یک چیز فقط گیج‌کننده بود.
    if unit is None and linked is not None:
        unit = linked.unit
    return {
        "title": inventory_service.clean_title(req.title, "نام قلم"),
        "qty": inventory_service.clean_number(
            req.qty, "تعداد", default=Decimal(1), minimum=Decimal("0.01")
        ),
        "unit": unit,
        "price": _clean_price(req.price),
        "note": inventory_service.clean_opt_text(req.note, _MAX_NOTE, "یادداشت"),
        "inventory_item_id": linked.id if linked is not None else None,
    }


def _clean_price(value: Decimal | None) -> Decimal | None:
    """قیمت **اختیاری** است — تصمیمِ مالک. صفر یعنی «نگفتم»، نه «مجانی».

    قیدِ دیتابیس `price IS NULL OR price > 0` است، پس صفر باید همین‌جا به
    None تبدیل شود وگرنه نوشتن می‌شکست.
    """
    if value is None:
        return None
    amount = inventory_service.clean_number(value, "قیمت")
    return amount if amount > 0 else None


def _assert_item_unique(
    db: Session,
    actor: Member,
    list_id: uuid.UUID,
    title: str,
    *,
    exclude: uuid.UUID | None = None,
) -> None:
    stmt = select(ShoppingItem.id).where(
        ShoppingItem.family_id == actor.family_id,
        ShoppingItem.list_id == list_id,
        ShoppingItem.title == title,
        ShoppingItem.bought_at.is_(None),
    )
    if exclude is not None:
        stmt = stmt.where(ShoppingItem.id != exclude)
    if db.execute(stmt).first() is not None:
        raise AppError(
            "DUPLICATE", f"«{title}» از قبل در این لیست هست.", 409
        )


def add_item_row(
    db: Session, actor: Member, list_id: uuid.UUID, req: ShoppingItemWrite
) -> ShoppingItem:
    parent = _get_list(db, actor, list_id)
    values = _prepare_item(db, actor, req)
    _assert_item_unique(db, actor, parent.id, values["title"])
    if len(_pending_of(db, actor, parent.id)) >= _MAX_ITEMS:
        raise AppError("LIMIT_REACHED", "تعداد اقلامِ این لیست به سقف رسیده است.", 409)
    row = ShoppingItem(
        family_id=actor.family_id,
        list_id=parent.id,
        created_by=actor.id,
        **values,
    )
    db.add(row)
    return row


def add_item(
    db: Session, actor: Member, list_id: uuid.UUID, req: ShoppingItemWrite
) -> ShoppingItemOut:
    row = add_item_row(db, actor, list_id, req)
    db.commit()
    db.refresh(row)
    return _item_out(row)


def _lock_operation(db: Session, actor: Member, operation_id: uuid.UUID) -> None:
    """Serialize the same receipt key across batch and offline endpoints."""
    lock_source = f"{actor.family_id}/{actor.id}/{operation_id}".encode()
    lock_key = int.from_bytes(hashlib.sha256(lock_source).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})


def _prepare_batch(req: ShoppingBatchRequest) -> list[dict]:
    # Stable first-occurrence order lets receipts identify aggregated request
    # items by index, without retaining ingredient names or quantities.
    grouped: dict[str, dict] = {}
    for item in req.items:
        title = inventory_service.clean_title(item.title, "نام قلم")
        unit = inventory_service.clean_opt_text(item.unit, _MAX_UNIT, "واحد")
        qty = inventory_service.clean_number(item.qty, "تعداد", minimum=Decimal("0.01"))
        existing = grouped.get(title)
        if existing is None:
            grouped[title] = {"title": title, "qty": qty, "unit": unit}
        elif existing["unit"] != unit:
            raise AppError(
                "INVALID_INPUT", f"برای «{title}» واحدهای متفاوت انتخاب شده است.", 422
            )
        else:
            existing["qty"] = inventory_service.clean_number(
                existing["qty"] + qty, "تعداد", minimum=Decimal("0.01")
            )
    return list(grouped.values())


def _batch_result(
    receipt: ShoppingSyncReceipt, prepared: list[dict], replayed: bool
) -> ShoppingBatchResult:
    result = receipt.result_json
    return ShoppingBatchResult(
        operation_id=str(receipt.operation_id),
        list_id=str(receipt.entity_id),
        replayed=replayed,
        added=[
            ShoppingBatchAdded(id=item["id"], **prepared[item["index"]])
            for item in result["added"]
        ],
        skipped=[
            ShoppingBatchSkipped(id=item["id"], title=prepared[item["index"]]["title"])
            for item in result["skipped"]
        ],
        added_count=result["added_count"],
        skipped_count=result["skipped_count"],
    )


def ensure_missing(
    db: Session, actor: Member, list_id: uuid.UUID, req: ShoppingBatchRequest
) -> ShoppingBatchResult:
    prepared = _prepare_batch(req)
    encoded = json.dumps(
        {
            "kind": "list.ensure-missing",
            "list_id": str(list_id),
            "body": req.model_dump(mode="json"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    request_hash = hashlib.sha256(encoded.encode()).hexdigest()
    _lock_operation(db, actor, req.operation_id)
    receipt = db.get(ShoppingSyncReceipt, (actor.family_id, actor.id, req.operation_id))
    if receipt is not None:
        if receipt.request_hash != request_hash:
            raise AppError(
                "OPERATION_REUSED", "شناسهٔ این تغییر قبلاً با اطلاعات دیگری استفاده شده است.", 409
            )
        return _batch_result(receipt, prepared, True)

    require_feature("shopping", write=True)
    parent = _get_list(db, actor, list_id)
    pending = _pending_of(db, actor, parent.id)
    existing = {item.title: item for item in _sort_items(pending)}
    missing_count = sum(item["title"] not in existing for item in prepared)
    if len(pending) + missing_count > _MAX_ITEMS:
        raise AppError("LIMIT_REACHED", "تعداد اقلامِ این لیست به سقف رسیده است.", 409)

    added: list[dict] = []
    skipped: list[dict] = []
    for index, values in enumerate(prepared):
        found = existing.get(values["title"])
        if found is not None:
            skipped.append({"id": str(found.id), "index": index})
            continue
        row = ShoppingItem(
            id=uuid.uuid4(),
            family_id=actor.family_id,
            list_id=parent.id,
            created_by=actor.id,
            **values,
        )
        db.add(row)
        added.append({"id": str(row.id), "index": index})

    # Acknowledgments retain only opaque ids and request positions. The matching
    # retry supplies its own validated content even after an item was deleted.
    receipt = ShoppingSyncReceipt(
        family_id=actor.family_id,
        member_id=actor.id,
        operation_id=req.operation_id,
        request_hash=request_hash,
        entity_type="list",
        entity_id=parent.id,
        revision=None,
        result_json={
            "added": added,
            "skipped": skipped,
            "added_count": len(added),
            "skipped_count": len(skipped),
        },
    )
    db.add(receipt)
    try:
        # Inserted items, parent revision triggers, and receipt commit together.
        db.commit()
    except IntegrityError:
        db.rollback()
        raise AppError(
            "SYNC_CONFLICT", "این تغییر با اطلاعات فعلی سرور سازگار نیست؛ دوباره بررسی‌اش کنید.", 409
        ) from None
    return _batch_result(receipt, prepared, False)


def update_item(
    db: Session, actor: Member, item_id: uuid.UUID, req: ShoppingItemWrite
) -> ShoppingItemOut:
    row = _get_item(db, actor, item_id)
    if row.bought_at is not None:
        # قیمتِ قلمِ خریده‌شده دیگر با تراکنشش هم‌خوان نمی‌ماند — عیناً
        # همان ۴۰۹ـی که قبضِ پرداخت‌شده می‌دهد.
        raise AppError(
            "ALREADY_BOUGHT",
            "این قلم خریده شده و قابل ویرایش نیست.",
            409,
        )
    values = _prepare_item(db, actor, req)
    _assert_item_unique(db, actor, row.list_id, values["title"], exclude=row.id)
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()
    db.refresh(row)
    return _item_out(row)


def check_item(
    db: Session, actor: Member, item_id: uuid.UUID, checked: bool
) -> ShoppingItemOut:
    """تیکِ «در سبد است» — کنشِ جدا از ویرایش، و بی‌اثر روی پول.

    خرج فقط در `complete_trip` ثبت می‌شود؛ این‌جا هیچ تراکنشی ساخته
    نمی‌شود، پس تیک‌زدن و برداشتن آزاد است.
    """
    row = _get_item(db, actor, item_id)
    if row.bought_at is not None:
        raise AppError("ALREADY_BOUGHT", "این قلم خریده شده است.", 409)
    row.checked = bool(checked)
    db.commit()
    db.refresh(row)
    return _item_out(row)


def delete_item(db: Session, actor: Member, item_id: uuid.UUID) -> None:
    row = _get_item(db, actor, item_id)
    if row.bought_at is not None:
        raise AppError(
            "ALREADY_BOUGHT",
            "قلمِ خریده‌شده حذف نمی‌شود؛ خرجش در گزارش‌ها هست.",
            409,
        )
    db.delete(row)
    db.commit()


# ── بستنِ سفرِ خرید ──────────────────────────────────────────
def complete_trip(
    db: Session, actor: Member, list_id: uuid.UUID, req: TripComplete
) -> TripResult:
    """اقلامِ تیک‌خورده را «خریده‌شده» می‌کند — در **یک** commit.

    سه کار هم‌زمان: تراکنشِ هزینه به مبلغِ جمعِ قیمت‌ها (§۴.۷ رابطهٔ
    `Shopping ↕ Finance`)، مهرِ خرید روی اقلام، و بالا رفتنِ موجودیِ
    انبار برای اقلامِ پیوندخورده.

    جمعِ صفر تراکنشی نمی‌سازد: لیستِ بی‌قیمت هم باید بسته شود، و تراکنشِ
    صفرتومانی در گزارش‌ها فقط نوفه بود (و `transactions._prepare` هم
    مبلغِ صفر را رد می‌کند).
    """
    from app.db.financial_lock import lock_financial_family
    lock_financial_family(db, actor.family_id)
    parent = _get_list(db, actor, list_id)
    items = [i for i in _pending_of(db, actor, parent.id) if i.checked]
    if not items:
        raise AppError(
            "NOTHING_CHECKED",
            "هیچ قلمی تیک نخورده است. آن‌چه خریده‌اید را تیک بزنید.",
            409,
        )

    total = sum((i.price or Decimal(0) for i in items), Decimal(0))
    bought_on = req.date or utcnow().date()

    tx_id: uuid.UUID | None = None
    if req.create_transaction and total > 0:
        # از همان موتورِ قاعدهٔ تراکنش می‌گذرد (اعتبارسنجیِ حساب، عضو،
        # دسته، مبلغ) — هیچ قاعده‌ای این‌جا دوباره نوشته نمی‌شود.
        tx = tx_service.create_uncommitted(
            db,
            actor.family_id,
            TransactionWrite(
                member_id=str(actor.id),
                type="expense",
                amount=total,
                category=_SHOPPING_CATEGORY,
                date=bought_on,
                account_id=req.account_id,
                note=parent.title,
            ),
        )
        tx_id = tx.id

    stamp = utcnow()
    inventory_service.lock_items_uncommitted(
        db, actor.family_id, {item.inventory_item_id for item in items if item.inventory_item_id is not None},
    )
    for item in items:
        item.bought_at = stamp
        item.bought_by_member_id = actor.id
        item.transaction_id = tx_id
        if item.inventory_item_id is not None:
            inventory_service.bump_uncommitted(
                db, actor.family_id, item.inventory_item_id, item.qty
            )

    db.commit()
    return TripResult(
        list=_list_out(parent, _pending_of(db, actor, parent.id)),
        total=total,
        item_count=len(items),
        transaction_id=str(tx_id) if tx_id else None,
    )


def list_uuid(raw: str) -> uuid.UUID:
    return to_uuid(raw, "NOT_FOUND", "لیست خرید یافت نشد.", 404)


def item_uuid(raw: str) -> uuid.UUID:
    return to_uuid(raw, "NOT_FOUND", "قلم لیست یافت نشد.", 404)
