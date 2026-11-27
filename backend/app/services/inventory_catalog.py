"""Packaged offline presets, public approved additions and anonymous proposals."""

import hashlib
import json
import unicodedata
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.inventory_catalog import InventoryCatalogEntry, InventoryCatalogProposal
from app.schemas.inventory_catalog import CatalogEntryOut, CatalogProposalOut, CatalogProposals, CatalogReview
from app.services.clock import utcnow

CATALOG = json.loads(
    (Path(__file__).resolve().parents[1] / "data" / "inventory.catalog.json").read_text(
        encoding="utf-8"
    )
)
GROUPS = frozenset(CATALOG)


def name_key(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower().translate(
        str.maketrans("يىكآأإٱۀە", "ییکااااهه")
    )
    return "".join(str(unicodedata.decimal(c)) if c.isdecimal() else c for c in value
                   if c.isalnum() and unicodedata.category(c) not in ("Mn", "Cf") and c != "ـ")


_TITLES: dict[str, set[str]] = {}
_ALIASES: dict[str, set[str]] = {}
for _group, _items in CATALOG.items():
    for _item in _items:
        _TITLES.setdefault(name_key(_item["title"]), set()).add(_group)
        for _alias in _item.get("aliases", []):
            _ALIASES.setdefault(name_key(_alias), set()).add(_group)


def infer_category(title: str) -> str | None:
    key = name_key(title)
    matches = _TITLES.get(key) or _ALIASES.get(key) or set()
    return next(iter(matches)) if len(matches) == 1 else None


def preset_id(title: str) -> str:
    # Category corrections do not change identity. Published additions receive
    # a persisted UUID; packaged titles use the same deterministic UUID forever.
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "https://khaanehyar.ir/inventory/" + name_key(title)))


def preset_catalog_id(title: str) -> str:
    """Stable cross-feature identity for a packaged catalog entry."""
    return "preset:" + name_key(title)


_CATALOG_KEYS: dict[str, str] = {}
for _group, _items in CATALOG.items():
    for _item in _items:
        _canonical = preset_catalog_id(_item["title"])
        _CATALOG_KEYS[name_key(_item["title"])] = _canonical
        for _alias in _item.get("aliases", []):
            _CATALOG_KEYS.setdefault(name_key(_alias), _canonical)


def catalog_id_for_title(title: str, db: Session | None = None) -> str | None:
    """Resolve a display title to its stable catalog identity."""
    key = name_key(title)
    if not key:
        return None
    if db is not None:
        entry = approved_entry(db, title)
        if entry is not None:
            return "entry:" + str(entry.id)
    return _CATALOG_KEYS.get(key)


def public_catalog(db: Session) -> list[CatalogEntryOut]:
    additions = list(db.scalars(select(InventoryCatalogEntry).order_by(InventoryCatalogEntry.title, InventoryCatalogEntry.id)))
    published_keys = {row.name_key for row in additions}
    entries = [CatalogEntryOut(id=preset_id(item["title"]), catalog_id=preset_catalog_id(item["title"]), title=item["title"], group=group,
                              unit=item["unit"], aliases=item.get("aliases", []), common=item.get("common", False))
               for group, items in CATALOG.items() for item in items if name_key(item["title"]) not in published_keys]
    entries.extend(CatalogEntryOut(id=str(row.id), catalog_id="entry:" + str(row.id), title=row.title, group=row.category, unit=row.unit or "")
                   for row in additions)
    return entries


def approved_entry(db: Session, title: str) -> InventoryCatalogEntry | None:
    return db.scalar(select(InventoryCatalogEntry).where(InventoryCatalogEntry.name_key == name_key(title)))


def clean_category(value: str | None, title: str, *, db: Session | None = None) -> str | None:
    if value is None:
        category = infer_category(title)
        if category is None and db is not None:
            entry = approved_entry(db, title)
            category = entry.category if entry else None
        return category
    if value not in GROUPS:
        raise AppError("INVALID_INPUT", "دستهٔ قلم معتبر نیست؛ دوباره انتخاب کنید.", 422)
    return value


def propose(db: Session, *, title: str, category: str | None, unit: str | None) -> None:
    """Called inside the inventory transaction; no identity or personal note enters here."""
    key = name_key(title)
    if category is None or key in _TITLES or key in _ALIASES or approved_entry(db, title) is not None:
        return
    digest = hashlib.sha256(
        json.dumps([key, category, name_key(unit or "")], ensure_ascii=False).encode()
    ).hexdigest()
    db.execute(insert(InventoryCatalogProposal).values(
        id=uuid.uuid4(), submission_key=digest, title=title, category=category, unit=unit,
    ).on_conflict_do_nothing(index_elements=["submission_key"]))


def proposal_out(row: InventoryCatalogProposal) -> CatalogProposalOut:
    return CatalogProposalOut(
        id=str(row.id), title=row.title, category=row.category, unit=row.unit,
        status=row.status, submitted_at=row.submitted_at, reviewed_at=row.reviewed_at,
        published_at=row.published_at,
    )


def list_proposals(db: Session, status: str, offset: int, limit: int) -> CatalogProposals:
    conditions = [] if status == "all" else [InventoryCatalogProposal.status == status]
    total = db.scalar(select(func.count()).select_from(InventoryCatalogProposal).where(*conditions))
    rows = db.scalars(
        select(InventoryCatalogProposal).where(*conditions)
        .order_by(InventoryCatalogProposal.submitted_at.desc(), InventoryCatalogProposal.id)
        .offset(offset).limit(limit)
    )
    return CatalogProposals(
        items=[proposal_out(row) for row in rows], total=total, offset=offset, limit=limit
    )


def review(db: Session, proposal_id: uuid.UUID, status: str, changes: CatalogReview | None = None) -> CatalogProposalOut:
    row = db.scalar(
        select(InventoryCatalogProposal)
        .where(InventoryCatalogProposal.id == proposal_id).with_for_update()
    )
    if row is None:
        raise AppError("NOT_FOUND", "پیشنهاد کالا پیدا نشد؛ فهرست را تازه کنید.", 404)
    fields = changes.model_fields_set if changes else set()
    title = " ".join(((changes.title if "title" in fields else row.title) or "").split())
    category = changes.category if "category" in fields else row.category
    unit = " ".join(((changes.unit if "unit" in fields else row.unit) or "").split()) or None
    if not title or len(title) > 120 or not name_key(title) or category not in GROUPS or (unit and len(unit) > 20):
        raise AppError("INVALID_INPUT", "نام، دسته و واحد پیشنهاد را بررسی کنید.", 422)
    unchanged = (name_key(row.title), row.category, row.unit) == (name_key(title), category, unit)
    if row.published_at is not None or row.status == "rejected":
        if row.status != status or not unchanged:
            raise AppError("SYNC_CONFLICT", "این پیشنهاد قبلاً بررسی شده است؛ فهرست را تازه کنید.", 409)
        return proposal_out(row)

    now = utcnow()
    if status == "approved":
        key = name_key(title)
        # A packaged title/alias already identifies a public item. Never create
        # a second identity for it or silently overwrite its metadata.
        if key in _TITLES or key in _ALIASES:
            matches = [(group, item) for group, items in CATALOG.items() for item in items
                       if name_key(item['title']) == key]
            if not matches:
                matches = [(group, item) for group, items in CATALOG.items() for item in items
                           if any(name_key(alias) == key for alias in item.get('aliases', []))]
            if len(matches) != 1 or matches[0][0] != category or unit != matches[0][1]['unit']:
                raise AppError("SYNC_CONFLICT", "این نام با مشخصات دیگری در فهرست کالاها وجود دارد؛ پیشنهاد را بررسی کنید.", 409)
        else:
            db.execute(insert(InventoryCatalogEntry).values(
                id=row.id, name_key=key, title=title, category=category, unit=unit, published_at=now,
            ).on_conflict_do_nothing(index_elements=["name_key"]))
            entry = approved_entry(db, title)
            if entry is None or (entry.category, entry.unit) != (category, unit):
                raise AppError("SYNC_CONFLICT", "قلمی با این نام و مشخصات متفاوت منتشر شده است؛ پیشنهاد را اصلاح کنید.", 409)
        row.published_at = now
    row.title, row.category, row.unit = title, category, unit
    row.status = status
    row.reviewed_at = now
    db.commit()
    db.refresh(row)
    return proposal_out(row)
