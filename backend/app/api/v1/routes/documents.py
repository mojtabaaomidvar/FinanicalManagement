"""Authenticated, uncached document CRUD and file retrieval."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy.orm import Session
from starlette.formparsers import MultiPartException, MultiPartParser

from app.api.deps import get_tenant_member
from app.core.config import settings
from app.core.errors import AppError
from app.db.document_scope import bind_member, clear_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.documents import DocumentOut, DocumentUpdate, DocumentWrite
from app.services import documents, ratelimit

router = APIRouter(tags=["documents"])
DbSession = Annotated[Session, Depends(get_db)]
_REQUEST_LIMIT = 12 * 1024 * 1024


def get_document_member(
    request: Request, member: Annotated[Member, Depends(get_tenant_member)], db: DbSession
) -> Iterator[Member]:
    documents.require_adult(member)
    ratelimit.hit(db, "documents", str(member.id), limit=settings.rl_documents_per_member)
    bind_member(db, member.id)
    try:
        yield member
    finally:
        clear_member(db)


DocumentMember = Annotated[Member, Depends(get_document_member)]


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(member: DocumentMember, db: DbSession, response: Response):
    no_store(response)
    return documents.list_for_member(db, member)


class _MemoryMultipartParser(MultiPartParser):
    # Sensitive uploads must never spool plaintext onto the server's temporary disk.
    spool_max_size = _REQUEST_LIMIT

    async def parse(self):
        try:
            return await super().parse()
        except BaseException:
            # Parser errors, disconnects and cancellation all discard temporary buffers.
            for temporary in self._files_to_close_on_error:
                temporary.close()
            raise


@router.post("/documents", response_model=DocumentOut, status_code=201)
async def create_document(
    request: Request, member: DocumentMember, db: DbSession, response: Response
):
    no_store(response)
    if request.headers.get("content-type", "").split(";", 1)[0].strip() != "multipart/form-data":
        raise AppError("INVALID_DOCUMENT", "فایل مدرک ارسال نشده است.", 422)

    async def bounded_stream():
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > _REQUEST_LIMIT:
                raise MultiPartException("document_too_large")
            yield chunk

    try:
        form = await _MemoryMultipartParser(
            request.headers, bounded_stream(), max_files=1, max_fields=5, max_part_size=4096
        ).parse()
    except MultiPartException as exc:
        if str(exc) == "document_too_large":
            raise AppError(
                "DOCUMENT_TOO_LARGE", "حجم فایل باید حداکثر ۱۰ مگابایت باشد.", 413
            ) from None
        raise AppError("INVALID_DOCUMENT", "فایل مدرک ارسال‌شده نامعتبر است.", 422) from None
    try:
        items = list(form.multi_items())
        if len({key for key, _ in items}) != len(items):
            raise AppError("INVALID_DOCUMENT", "فیلد تکراری مجاز نیست.", 422)
        fields = dict(items)
        upload = fields.pop("file", None)
        # Starlette creates UploadFile, while FastAPI's subclass uses the same interface.
        if upload is None or not hasattr(upload, "read") or not hasattr(upload, "filename"):
            raise AppError("INVALID_DOCUMENT", "فایل مدرک ارسال نشده است.", 422)
        if fields.get("expiry_date") == "":
            fields["expiry_date"] = None
        if fields.get("category") == "":
            fields["category"] = None
        try:
            body = DocumentWrite(**fields)
        except ValidationError:
            raise AppError("INVALID_INPUT", "اطلاعات مدرک نامعتبر است.", 422) from None
        data = await upload.read(documents.MAX_FILE_BYTES + 1)
        return documents.create(
            db, member, body, upload.filename or "document", upload.content_type, data
        )
    finally:
        await form.close()


@router.patch("/documents/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: uuid.UUID,
    body: DocumentUpdate,
    member: DocumentMember,
    db: DbSession,
    response: Response,
):
    no_store(response)
    return documents.update(db, member, document_id, body)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(
    document_id: uuid.UUID,
    base_revision: Annotated[int, Query(ge=1)],
    member: DocumentMember,
    db: DbSession,
):
    documents.delete(db, member, document_id, base_revision)
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


@router.get("/documents/{document_id}/file")
def get_document_file(document_id: uuid.UUID, member: DocumentMember, db: DbSession):
    data, mime = documents.file_content(db, member, document_id)
    # Edge may turn native fetch replies with Content-Disposition into empty 204s.
    # The UI names downloads using the already-authorized document metadata instead.
    return Response(
        content=data,
        media_type=mime,
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": (
                "default-src 'none'; object-src 'none'; frame-ancestors 'none'"
            ),
        },
    )
