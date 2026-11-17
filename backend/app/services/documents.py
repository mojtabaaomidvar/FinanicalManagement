"""Online-only documents with server authorization and authenticated encryption."""

from __future__ import annotations

import json
import logging
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.core.errors import AppError
from app.models.document import HouseholdDocument
from app.models.family import Member
from app.schemas.documents import DocumentOut, DocumentUpdate, DocumentWrite
from app.services import storage
from app.services.common import is_admin
from app.services.encrypted_payload import cipher_from_key, decrypt_payload, encrypt_payload
from app.services.inventory import clean_opt_text, clean_title
from app.services.member_age import document_age_restricted

logger = logging.getLogger(__name__)
MAX_FILE_BYTES = 10 * 1024 * 1024
_PREFIX = b"KYDOC1"
_MIMES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}


def audit(action: str, actor: Member, document_id: object | None, permitted: bool) -> None:
    # Intentionally omit all contents, titles, filenames, paths and access tokens.
    logger.info(
        "document action=%s actor=%s document=%s permitted=%s",
        action,
        actor.id,
        document_id or "none",
        permitted,
    )


def require_adult(actor: Member, action: str = "access", document_id: object | None = None) -> None:
    denied = document_age_restricted(actor)
    denied = denied or actor.membership_state != "active" or actor.status != "active"
    if denied:
        audit(action, actor, document_id, False)
        raise AppError("DOCUMENT_FORBIDDEN", "دسترسی به مدارک برای این حساب مجاز نیست.", 403)


def _cipher() -> AESGCM:
    try:
        return cipher_from_key(settings.document_encryption_key)
    except ValueError:
        raise AppError(
            "DOCUMENTS_NOT_CONFIGURED", "ذخیره‌سازی امن مدارک پیکربندی نشده است.", 503
        ) from None


def _aad(row: HouseholdDocument, kind: str) -> bytes:
    return f"khaneyar-document-v1:{row.family_id}:{row.id}:{kind}".encode("ascii")


def _encrypt(row: HouseholdDocument, kind: str, data: bytes) -> bytes:
    return encrypt_payload(_cipher(), data, prefix=_PREFIX, aad=_aad(row, kind))


def _decrypt(row: HouseholdDocument, kind: str, data: bytes) -> bytes:
    cipher = _cipher()
    try:
        return decrypt_payload(cipher, data, prefix=_PREFIX, aad=_aad(row, kind))
    except (InvalidTag, ValueError):
        raise AppError("DOCUMENT_UNAVAILABLE", "فایل مدرک قابل خواندن نیست.", 503) from None


def _metadata(row: HouseholdDocument) -> dict:
    try:
        return json.loads(_decrypt(row, "metadata", row.encrypted_metadata))
    except (ValueError, UnicodeError):
        raise AppError("DOCUMENT_UNAVAILABLE", "اطلاعات مدرک قابل خواندن نیست.", 503) from None


def _set_metadata(row: HouseholdDocument, values: dict) -> None:
    row.encrypted_metadata = _encrypt(
        row, "metadata", json.dumps(values, ensure_ascii=False).encode("utf-8")
    )


def object_path(row: HouseholdDocument) -> str:
    return f"private-documents/{row.family_id}/{row.owner_id}/{row.id}.bin"


def _visible(actor: Member, row: HouseholdDocument) -> bool:
    return row.family_id == actor.family_id and (
        row.visibility == "shared" or row.owner_id == actor.id
    )


def _can_modify(actor: Member, row: HouseholdDocument) -> bool:
    return _visible(actor, row) and (
        row.owner_id == actor.id or (row.visibility == "shared" and is_admin(actor))
    )


def document_out(row: HouseholdDocument, actor: Member) -> DocumentOut:
    data = _metadata(row)
    allowed = _can_modify(actor, row)
    return DocumentOut(
        id=str(row.id),
        title=data["title"],
        category=data["category"],
        visibility=row.visibility,
        expiry_date=row.expiry_date,
        reminder_enabled=row.reminder_enabled,
        owner_id=str(row.owner_id),
        mime_type=row.mime_type,
        file_name=data["file_name"],
        file_size=row.file_size,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
        can_edit=allowed,
        can_delete=allowed,
        can_change_visibility=row.owner_id == actor.id,
    )


def list_for_member(db: Session, actor: Member) -> list[DocumentOut]:
    require_adult(actor, "list")
    _cipher()
    rows = db.scalars(
        select(HouseholdDocument)
        .where(
            HouseholdDocument.family_id == actor.family_id,
            (HouseholdDocument.visibility == "shared") | (HouseholdDocument.owner_id == actor.id),
        )
        .order_by(
            HouseholdDocument.expiry_date.asc().nulls_last(),
            HouseholdDocument.created_at.desc(),
            HouseholdDocument.id,
        )
    )
    result = [document_out(row, actor) for row in rows]
    audit("list", actor, None, True)
    return result


def _find(
    db: Session, actor: Member, document_id: uuid.UUID, action: str, *, lock: bool = False
) -> HouseholdDocument:
    require_adult(actor, action, document_id)
    query = select(HouseholdDocument).where(
        HouseholdDocument.id == document_id, HouseholdDocument.family_id == actor.family_id
    )
    if lock:
        # Check readable objects before FOR UPDATE applies restrictive write RLS.
        current = db.scalar(query.execution_options(populate_existing=True))
        if current is not None and _visible(actor, current) and not _can_modify(actor, current):
            audit(action, actor, document_id, False)
            raise AppError("DOCUMENT_FORBIDDEN", "اجازهٔ تغییر این مدرک را ندارید.", 403)
    if lock:
        query = query.with_for_update()
    row = db.scalar(query.execution_options(populate_existing=True))
    if row is None or not _visible(actor, row):
        audit(action, actor, document_id, False)
        raise AppError("NOT_FOUND", "مدرک یافت نشد.", 404)
    return row


def validate_file(data: bytes, mime: str | None) -> str:
    if not data:
        raise AppError("INVALID_DOCUMENT", "فایل مدرک خالی یا نامعتبر است.", 422)
    if len(data) > MAX_FILE_BYTES:
        raise AppError("DOCUMENT_TOO_LARGE", "حجم فایل باید حداکثر ۱۰ مگابایت باشد.", 413)
    actual = None
    if data.startswith(b"%PDF-") and b"%%EOF" in data[-1024:]:
        actual = "application/pdf"
    elif data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 33 and data[12:16] == b"IHDR":
        actual = "image/png"
    elif data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        actual = "image/jpeg"
    elif (
        len(data) >= 20
        and data[:4] == b"RIFF"
        and data[8:12] == b"WEBP"
        and int.from_bytes(data[4:8], "little") + 8 == len(data)
    ):
        actual = "image/webp"
    if actual is None or mime not in _MIMES or mime != actual:
        raise AppError(
            "INVALID_DOCUMENT", "فقط فایل PDF یا تصویر JPEG، PNG و WebP معتبر مجاز است.", 422
        )
    return actual


def create(
    db: Session, actor: Member, body: DocumentWrite, file_name: str, mime: str | None, data: bytes
) -> DocumentOut:
    require_adult(actor, "create")
    _cipher()
    actual = validate_file(data, mime)
    filename = file_name.replace("\\", "/").rsplit("/", 1)[-1]
    filename = "".join(c for c in filename if ord(c) >= 32 and c != "\x7f")[:200] or "document"
    row = HouseholdDocument(
        id=uuid.uuid4(),
        family_id=actor.family_id,
        owner_id=actor.id,
        visibility=body.visibility,
        expiry_date=body.expiry_date,
        reminder_enabled=body.reminder_enabled,
        mime_type=actual,
        file_size=len(data),
    )
    _set_metadata(
        row,
        {
            "title": clean_title(body.title, "عنوان مدرک"),
            "category": clean_opt_text(body.category, 80, "دسته‌بندی"),
            "file_name": filename,
        },
    )
    path = object_path(row)
    storage.get_storage().save(path, _encrypt(row, "file", data))
    try:
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        _remove_file(path, actor, row.id)
        raise
    # A refresh failure after successful commit must not destroy a saved file.
    db.refresh(row)
    audit("create", actor, row.id, True)
    return document_out(row, actor)


def _check_change(actor: Member, row: HouseholdDocument, base_revision: int, action: str) -> None:
    if not _can_modify(actor, row):
        audit(action, actor, row.id, False)
        raise AppError("DOCUMENT_FORBIDDEN", "اجازهٔ تغییر این مدرک را ندارید.", 403)
    if row.revision != base_revision:
        raise AppError("SYNC_CONFLICT", "این مدرک تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.", 409)


def update(db: Session, actor: Member, document_id: uuid.UUID, body: DocumentUpdate) -> DocumentOut:
    row = _find(db, actor, document_id, "update", lock=True)
    _check_change(actor, row, body.base_revision, "update")
    changes = body.model_dump(exclude={"base_revision"}, exclude_unset=True)
    if (
        "visibility" in changes
        and changes["visibility"] != row.visibility
        and row.owner_id != actor.id
    ):
        audit("change_visibility", actor, row.id, False)
        raise AppError("DOCUMENT_FORBIDDEN", "فقط صاحب مدرک می‌تواند اشتراک‌گذاری را تغییر دهد.", 403)
    metadata = _metadata(row)
    if "title" in changes:
        metadata["title"] = clean_title(changes.pop("title"), "عنوان مدرک")
    if "category" in changes:
        metadata["category"] = clean_opt_text(changes.pop("category"), 80, "دسته‌بندی")
    _set_metadata(row, metadata)
    for field, value in changes.items():
        setattr(row, field, value)
    flag_modified(row, "encrypted_metadata")
    db.commit()
    db.refresh(row)
    audit("update", actor, row.id, True)
    return document_out(row, actor)


def _remove_file(path: str, actor: Member, document_id: object) -> None:
    try:
        storage.get_storage().delete(path)
    except Exception:
        # The record is already revoked. Do not reveal filesystem or provider details.
        logger.warning("document cleanup_failed actor=%s document=%s", actor.id, document_id)


def delete(db: Session, actor: Member, document_id: uuid.UUID, base_revision: int) -> None:
    row = _find(db, actor, document_id, "delete", lock=True)
    _check_change(actor, row, base_revision, "delete")
    path = object_path(row)
    db.delete(row)
    db.commit()
    _remove_file(path, actor, row.id)
    audit("delete", actor, row.id, True)


def file_content(db: Session, actor: Member, document_id: uuid.UUID) -> tuple[bytes, str]:
    row = _find(db, actor, document_id, "file")
    data = _decrypt(row, "file", storage.get_storage().load(object_path(row)))
    audit("file", actor, row.id, True)
    return data, row.mime_type
