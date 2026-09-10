"""ذخیره‌سازیِ فایلِ آپلودی + امضای HMACِ URLها (فاز ۸).

جایگزینِ باکت‌های «عمومیِ» Supabase Storage. دو نگرانیِ جدا:

۱) «کجا» بایت‌ها ذخیره شوند → StorageBackend (LocalDiskStorage یا S3Storage؛
   انتخاب فقط با env، بدونِ تغییرِ روت‌ها).

۲) «چطور» فایل امن سرو شود → URLِ قابلیتیِ امضاشده با HMAC.
   چرا URLِ امضاشدهٔ «بی‌انقضا» (durable capability URL)؟ چون این URLها در دیتابیس
   ذخیره می‌شوند (Member.avatar_url، عکسِ تراکنش) و با تگِ <img> رندر می‌شوند — پس
   نه می‌توان هدرِ Authorization فرستاد و نه می‌توان انقضای کوتاه گذاشت (URLِ
   ذخیره‌شده باید همیشه کار کند). راه‌حل: مسیرِ فایل با کلیدِ سرور HMAC می‌شود؛ داشتنِ
   «امضای معتبر» یعنی «مجوزِ دیدن». اما «آپلود» با نشستِ Bearer محافظت می‌شود، نه
   قابلیت — تا فقط اعضای واردشده بتوانند فایلِ تازه بسازند.

تفاوت با باکت‌های عمومیِ قبلی: آنجا URL کاملاً حدس‌زدنی/عمومی بود؛ اینجا بدونِ امضای
معتبر (که فقط سرور می‌تواند بسازد) هیچ فایلی سرو نمی‌شود.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from app.core.config import settings
from app.core.errors import AppError

# mime → پسوند (هم‌سان با توابع سرورلسِ قبلی: png/jpeg/webp)
_ALLOWED: dict[str, str] = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}
# پسوند → mime (برای Content-Type هنگامِ سرو کردن)
_EXT_MIME: dict[str, str] = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}

# فقط dataURLِ تصویرِ base64 با mimeهای مجاز (هم‌سان با regexِ توابع سرورلس)
_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$")

# بخشِ امنِ مسیر: حرف/عدد/نقطه/زیرخط/خط‌تیره (UUID و timestamp را پوشش می‌دهد)
_SAFE_SEG = re.compile(r"^[A-Za-z0-9._-]+$")


@dataclass(frozen=True)
class DecodedImage:
    """نتیجهٔ دیکودِ یک dataURLِ تصویر."""

    mime: str
    ext: str
    data: bytes


# ── دیکود و اعتبارسنجیِ تصویرِ ورودی ──────────────────────────
def decode_data_url(data_url: str | None, max_bytes: int) -> DecodedImage:
    """dataURL → (mime, ext, bytes)؛ با کدهای خطای پایدارِ هم‌سان با نسخهٔ قبلی.

    INVALID_IMAGE اگر قالب/base64 خراب یا خالی باشد؛ IMAGE_TOO_LARGE اگر بایتِ
    دیکودشده از max_bytes بیشتر شود. سقف روی «بایتِ دیکودشده» سنجیده می‌شود (نه طولِ
    base64) که دقیق‌تر از نسخهٔ سرورلسِ قبلی است.
    """
    if not data_url:
        raise AppError("INVALID_IMAGE", "تصویر نامعتبر است.", 400)
    m = _DATA_URL.match(data_url)
    if not m:
        raise AppError("INVALID_IMAGE", "تصویر نامعتبر است.", 400)
    mime = m.group(1)
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise AppError("INVALID_IMAGE", "تصویر نامعتبر است.", 400) from exc
    if not raw:
        raise AppError("INVALID_IMAGE", "تصویر نامعتبر است.", 400)
    if len(raw) > max_bytes:
        raise AppError("IMAGE_TOO_LARGE", "حجم تصویر بیش از حد مجاز است.", 400)
    return DecodedImage(mime=mime, ext=_ALLOWED[mime], data=raw)


# ── امضای HMACِ مسیر (کلیدِ سرور؛ راز) ────────────────────────
def require_configured() -> None:
    """اگر کلیدِ امضا تنظیم نشده باشد، fail-closed با SERVER_NOT_CONFIGURED.

    بدونِ کلید نه می‌توان امضا ساخت (آپلود) نه راستی‌آزمایی کرد (سرو). این را در
    ابتدای هر دو روت صدا می‌زنیم تا خطای واضحِ عملیاتی بدهد، نه ۴۰۳/۴۰۴ گمراه‌کننده.
    """
    if not settings.file_signing_secret:
        raise AppError(
            "SERVER_NOT_CONFIGURED", "ذخیره‌سازی فایل پیکربندی نشده است.", 500
        )


def sign_path(path: str) -> str:
    """امضای HMAC-SHA256ِ مسیرِ ذخیره (هگز)."""
    key = settings.file_signing_secret.encode("utf-8")
    return hmac.new(key, path.encode("utf-8"), hashlib.sha256).hexdigest()


def verify_path(path: str, sig: str | None) -> bool:
    """راستی‌آزماییِ ثابت-زمانِ امضا در برابرِ مسیر."""
    if not sig:
        return False
    return hmac.compare_digest(sign_path(path), sig)


def build_url(path: str) -> str:
    """URLِ کاملِ قابلِ ذخیره در DB: {files_base_url}/api/v1/files/{path}?sig=...

    اگر files_base_url خالی باشد، URLِ نسبی (هم‌مبدأ) برمی‌گردد که در <img> کار می‌کند.
    """
    sig = sign_path(path)
    base = settings.files_base_url.rstrip("/")
    return f"{base}/api/v1/files/{path}?sig={sig}"


def make_object_path(
    bucket: str, member_id: str, ext: str, *, unique: bool = False
) -> str:
    """مسیرِ آبجکت: '{bucket}/{member_id}-{ts_ms}[-rand].{ext}' (هم‌سان با نام‌گذاریِ قبلی).

    unique=True یک پسوندِ تصادفی می‌افزاید (برای عکسِ تراکنش که چند فایل در یک میلی‌ثانیه
    ممکن است؛ آواتار چون هر بار جایگزین می‌شود لازم ندارد).
    """
    ts = int(time.time() * 1000)
    name = f"{member_id}-{ts}"
    if unique:
        name = f"{name}-{secrets.token_hex(3)}"
    return f"{bucket}/{name}.{ext}"


def content_type_for(path: str) -> str:
    """Content-Type از روی پسوندِ مسیر (پیش‌فرض octet-stream)."""
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return _EXT_MIME.get(ext, "application/octet-stream")


# ── لایهٔ ذخیره‌سازی (دیسکِ محلی یا S3؛ انتخاب با env) ─────────
class StorageBackend(Protocol):
    """قراردادِ ذخیره‌سازی — LocalDiskStorage و S3Storage آن را پیاده می‌کنند (انتخاب با env)."""

    def save(self, path: str, data: bytes) -> None: ...

    def load(self, path: str) -> bytes: ...


class LocalDiskStorage:
    """ذخیره روی دیسکِ محلی زیرِ یک ریشه، با محافظت در برابرِ path traversal."""

    def __init__(self, root: str) -> None:
        self._root = Path(root).resolve()

    def _resolve(self, path: str) -> Path:
        """مسیرِ نسبی → مسیرِ مطلقِ درونِ ریشه؛ NOT_FOUND اگر مشکوک به traversal.

        دو لایهٔ دفاع: (۱) هر بخشِ مسیر باید با _SAFE_SEG بخواند و '.'/'..' نباشد،
        (۲) مسیرِ resolve‌شده باید واقعاً زیرِ ریشه بیفتد.
        """
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        for p in parts:
            if p in (".", "..") or not _SAFE_SEG.match(p):
                raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        full = (self._root / Path(*parts)).resolve()
        if full != self._root and self._root not in full.parents:
            raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        return full

    def save(self, path: str, data: bytes) -> None:
        full = self._resolve(path)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(data)

    def load(self, path: str) -> bytes:
        full = self._resolve(path)
        if not full.is_file():
            raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        return full.read_bytes()


class S3Storage:
    """ذخیره روی فضای آبجکتِ سازگار با S3 (مثلِ Object Storageِ لیارا).

    فقط وقتی فعال می‌شود که هر دویِ storage_endpoint و storage_bucket ست باشند
    (انتخاب در _build_storage). مسیرِ آبجکت (مثلِ 'avatars/xxx.png') به‌عنوانِ Key
    درونِ همان یک باکت به‌کار می‌رود؛ پیشوندهای avatars/ و tx-photos/ صرفاً بخشی از
    کلیدند. روت‌ها تغییر نمی‌کنند: سرو همچنان بایت‌ها را از این backend می‌خواند و با
    URLِ امضاشدهٔ HMAC پروکسی می‌کند (نه لینکِ مستقیمِ باکت) — پس باکت می‌تواند خصوصی بماند.
    """

    def __init__(self) -> None:
        try:
            import boto3
            from botocore.config import Config as _BotoConfig
            from botocore.exceptions import ClientError as _ClientError
        except ImportError as exc:  # pragma: no cover
            raise AppError(
                "SERVER_NOT_CONFIGURED",
                "بستهٔ boto3 نصب نیست؛ برای ذخیره‌سازیِ S3 لازم است.",
                500,
            ) from exc
        self._bucket = settings.storage_bucket
        self._client_error = _ClientError
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.storage_endpoint,
            aws_access_key_id=settings.storage_access_key,
            aws_secret_access_key=settings.storage_secret_key,
            region_name=settings.storage_region,
            config=_BotoConfig(signature_version="s3v4"),
        )

    @staticmethod
    def _safe_key(path: str) -> str:
        """اعتبارسنجیِ بخش‌های مسیر (هم‌سان با دیسک) → کلیدِ نرمال‌شده؛ NOT_FOUND اگر مشکوک."""
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        for p in parts:
            if p in (".", "..") or not _SAFE_SEG.match(p):
                raise AppError("NOT_FOUND", "فایل یافت نشد.", 404)
        return "/".join(parts)

    def save(self, path: str, data: bytes) -> None:
        key = self._safe_key(path)
        self._client.put_object(
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type_for(key),
        )

    def load(self, path: str) -> bytes:
        key = self._safe_key(path)
        try:
            obj = self._client.get_object(Bucket=self._bucket, Key=key)
            return obj["Body"].read()
        except self._client_error as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in ("NoSuchKey", "NoSuchBucket", "404"):
                raise AppError("NOT_FOUND", "فایل یافت نشد.", 404) from exc
            raise AppError("STORAGE_ERROR", "خطا در خواندنِ فایل.", 502) from exc


def _build_storage() -> StorageBackend:
    """انتخابِ backend از روی env: S3 اگر endpoint+bucket ست باشند، وگرنه دیسکِ محلی.

    غیرمخرب: بدونِ ستِ این دو متغیر، رفتار دقیقاً مثلِ قبل (دیسک) است.
    """
    if settings.storage_endpoint and settings.storage_bucket:
        return S3Storage()
    return LocalDiskStorage(settings.storage_dir)


_storage: StorageBackend = _build_storage()


def get_storage() -> StorageBackend:
    """نمونهٔ واحدِ backendِ ذخیره‌سازی."""
    return _storage
