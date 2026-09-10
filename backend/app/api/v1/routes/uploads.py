"""روت‌های آپلودِ تصویر — آواتار و عکسِ تراکنش (فاز ۸).

جایگزینِ توابعِ سرورلسِ api/upload-avatar.js و api/upload-photo.js. تفاوتِ کلیدی:
احراز اکنون با نشستِ Bearer است (get_current_member)، نه «توکن-در-بدنه». تصویر به‌صورتِ
dataURLِ base64 می‌آید، سمتِ سرور اعتبارسنجی و ذخیره می‌شود و یک URLِ امضاشدهٔ HMAC
برمی‌گردد که در DB ذخیره و با <img> رندر می‌شود (جزئیات در services/storage.py).

این روت‌ها «هویتی»‌اند (get_current_member) و به RLSِ خانواده نیاز ندارند، چون
ذخیره‌سازیِ فایل یک جدولِ دیتابیس نیست؛ به همین دلیل بیرون از روت‌های دادهٔ
get_tenant_member قرار دارند (هم‌راستا با مرزِ فاز ۷).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_current_member
from app.core.config import settings
from app.models.family import Member
from app.schemas.data import UploadIn, UploadOut
from app.services import storage

router = APIRouter(tags=["uploads"])


@router.post("/uploads/avatar", response_model=UploadOut)
def upload_avatar(
    body: UploadIn,
    member: Member = Depends(get_current_member),
) -> UploadOut:
    """آپلودِ آواتارِ عضو جاری → URLِ امضاشده. نامِ فایل بدونِ rand (هر بار جایگزین)."""
    storage.require_configured()
    img = storage.decode_data_url(body.image, settings.upload_max_bytes)
    path = storage.make_object_path(
        settings.storage_bucket_avatars, str(member.id), img.ext
    )
    storage.get_storage().save(path, img.data)
    return UploadOut(ok=True, url=storage.build_url(path))


@router.post("/uploads/photo", response_model=UploadOut)
def upload_photo(
    body: UploadIn,
    member: Member = Depends(get_current_member),
) -> UploadOut:
    """آپلودِ عکسِ پیوستِ تراکنش → URLِ امضاشده. نامِ فایل با پسوندِ تصادفی (چند عکس)."""
    storage.require_configured()
    img = storage.decode_data_url(body.image, settings.upload_max_bytes)
    path = storage.make_object_path(
        settings.storage_bucket_photos, str(member.id), img.ext, unique=True
    )
    storage.get_storage().save(path, img.data)
    return UploadOut(ok=True, url=storage.build_url(path))
