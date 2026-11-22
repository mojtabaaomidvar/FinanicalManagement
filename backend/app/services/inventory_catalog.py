"""Static preset lookup and anonymous proposals. Approval never publishes presets."""

import hashlib
import json
import unicodedata
import uuid
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models.inventory_catalog import InventoryCatalogProposal
from app.schemas.inventory_catalog import CatalogProposalOut, CatalogProposals
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


def clean_category(value: str | None, title: str) -> str | None:
    if value is None:
        return infer_category(title)
    if value not in GROUPS:
        raise AppError("INVALID_INPUT", "دستهٔ قلم معتبر نیست؛ دوباره انتخاب کنید.", 422)
    return value


def propose(db: Session, *, title: str, category: str | None, unit: str | None) -> None:
    """Called inside the inventory transaction; no identity or personal note enters here."""
    key = name_key(title)
    if category is None or key in _TITLES or key in _ALIASES:
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


def review(db: Session, proposal_id: uuid.UUID, status: str) -> CatalogProposalOut:
    row = db.scalar(
        select(InventoryCatalogProposal)
        .where(InventoryCatalogProposal.id == proposal_id).with_for_update()
    )
    if row is None:
        raise AppError("NOT_FOUND", "پیشنهاد کالا پیدا نشد؛ فهرست را تازه کنید.", 404)
    if row.status != status:
        if row.status != "pending":
            raise AppError(
                "SYNC_CONFLICT", "این پیشنهاد قبلاً بررسی شده است؛ فهرست را تازه کنید.", 409
            )
        row.status = status
        row.reviewed_at = utcnow()
    db.commit()
    db.refresh(row)
    return proposal_out(row)
