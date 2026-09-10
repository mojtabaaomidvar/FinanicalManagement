"""سرو کردنِ فایلِ آپلودی با URLِ امضاشدهٔ HMAC (فاز ۸).

این روت «عمداً» هیچ وابستگیِ احراز هویت ندارد: فایل‌ها با تگِ <img> بارگذاری می‌شوند
که نمی‌تواند هدرِ Authorization بفرستد. در عوض، مجوز «در خودِ URL» است — پارامترِ
`sig` یک HMAC-SHA256ِ مسیر با کلیدِ سرور است. بدونِ امضای معتبر (که فقط سرور می‌تواند
بسازد) هیچ بایتی سرو نمی‌شود (fail-closed، ۴۰۳).

چون این URLها در DB ذخیره می‌شوند و محتوای هر مسیر ثابت است (نامِ فایل timestamp دارد
و بازنویسی نمی‌شود)، Cache-Controlِ طولانی و immutable امن است.
"""

from __future__ import annotations

from fastapi import APIRouter, Query, Response

from app.core.errors import AppError
from app.services import storage

router = APIRouter(tags=["files"])


@router.get("/files/{path:path}")
def serve_file(path: str, sig: str | None = Query(default=None)) -> Response:
    """سرو کردنِ فایل اگر امضا معتبر باشد؛ وگرنه FORBIDDEN."""
    storage.require_configured()
    if not storage.verify_path(path, sig):
        raise AppError("FORBIDDEN", "امضای فایل نامعتبر است.", 403)
    data = storage.get_storage().load(path)
    return Response(
        content=data,
        media_type=storage.content_type_for(path),
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
