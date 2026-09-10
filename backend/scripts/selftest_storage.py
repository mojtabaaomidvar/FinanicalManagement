"""خودآزمونِ DB-free برای services/storage.py (فاز ۸).

بدونِ نیاز به دیتابیس، سرور یا حتیٰ pydantic اجرا می‌شود (VMِ راستی‌آزمایی وابستگیِ
شخصِ‌ثالث ندارد). به‌جای بارکردنِ config واقعی (که به pydantic-settings نیاز دارد)، یک
ماژولِ «بدل» برای app.core.config در sys.modules تزریق می‌کنیم؛ منطقِ storage.py هیچ
تفاوتی نمی‌بیند چون فقط به صفتِ settings نیاز دارد.
اجرا:  python3 scripts/selftest_storage.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── بدلِ config: پیش از importِ storage تزریق شود ──
_TMP = tempfile.mkdtemp(prefix="khaneyar_storage_test_")
_cfg = types.ModuleType("app.core.config")


class _FakeSettings:
    file_signing_secret = "test-secret-please-change"
    files_base_url = "https://api.example.test"
    storage_dir = _TMP
    storage_bucket_avatars = "avatars"
    storage_bucket_photos = "tx-photos"
    upload_max_bytes = 1_050_000


_cfg.settings = _FakeSettings()  # type: ignore[attr-defined]
sys.modules["app.core.config"] = _cfg

from app.core.errors import AppError  # noqa: E402
from app.services import storage  # noqa: E402

_fails: list[str] = []


def check(label: str, cond: bool) -> None:
    mark = "✅" if cond else "❌"
    print(f"  {mark} {label}")
    if not cond:
        _fails.append(label)


def expect_apperror(label: str, code: str, fn) -> None:
    try:
        fn()
    except AppError as e:
        check(f"{label} → {code}", e.code == code)
    else:
        check(f"{label} → {code}", False)


# یک PNGِ ۱x۱ معتبر (base64)
_PNG_1x1 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk"
    "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
_PNG_DATAURL = f"data:image/png;base64,{_PNG_1x1}"


print("① امضا و راستی‌آزمایی")
p = "avatars/abc-123.png"
sig = storage.sign_path(p)
check("verify(امضای درست)", storage.verify_path(p, sig) is True)
check("verify(امضای غلط)", storage.verify_path(p, "deadbeef") is False)
check("verify(بدونِ امضا)", storage.verify_path(p, None) is False)
check("verify(مسیرِ دستکاری‌شده)", storage.verify_path("avatars/OTHER.png", sig) is False)

print("\n② ساختِ URL")
url = storage.build_url(p)
check("URL شاملِ base", url.startswith("https://api.example.test/api/v1/files/"))
check("URL شاملِ مسیر", "/api/v1/files/avatars/abc-123.png?sig=" in url)
check("URL شاملِ همان امضا", url.endswith(sig))

print("\n③ دیکودِ dataURL")
img = storage.decode_data_url(_PNG_DATAURL, 1_050_000)
check("mime = image/png", img.mime == "image/png")
check("ext = png", img.ext == "png")
check("bytes غیرخالی", len(img.data) > 0)
expect_apperror("خالی", "INVALID_IMAGE", lambda: storage.decode_data_url("", 1_050_000))
expect_apperror("None", "INVALID_IMAGE", lambda: storage.decode_data_url(None, 1_050_000))
expect_apperror(
    "قالبِ نامعتبر", "INVALID_IMAGE", lambda: storage.decode_data_url("hello", 1_050_000)
)
expect_apperror(
    "mimeِ غیرمجاز (gif)",
    "INVALID_IMAGE",
    lambda: storage.decode_data_url("data:image/gif;base64,AAAA", 1_050_000),
)
expect_apperror(
    "بزرگ‌تر از سقف",
    "IMAGE_TOO_LARGE",
    lambda: storage.decode_data_url(_PNG_DATAURL, 10),
)

print("\n④ نامِ آبجکت")
ap = storage.make_object_path("avatars", "mem-1", "png")
pp = storage.make_object_path("tx-photos", "mem-1", "jpg", unique=True)
check("آواتار زیرِ باکتِ درست", ap.startswith("avatars/mem-1-"))
check("آواتار پسوندِ درست", ap.endswith(".png"))
check("عکس زیرِ باکتِ درست", pp.startswith("tx-photos/mem-1-"))
check("عکس پسوندِ درست", pp.endswith(".jpg"))
check("عکس یکتا (rand دارد)", pp.count("-") >= 3)

print("\n⑤ ذخیره/خواندن روی دیسک")
store = storage.get_storage()
store.save(ap, img.data)
loaded = store.load(ap)
check("round-trip بایت‌ها برابر", loaded == img.data)
check("content_type از پسوند", storage.content_type_for(ap) == "image/png")
check("content_type jpg", storage.content_type_for("x/y.jpg") == "image/jpeg")

print("\n⑥ محافظت در برابرِ path traversal")
expect_apperror("..", "NOT_FOUND", lambda: store.load("../secret.txt"))
expect_apperror("..ِ تودرتو", "NOT_FOUND", lambda: store.load("avatars/../../etc/passwd"))
expect_apperror("مسیرِ خالی", "NOT_FOUND", lambda: store.load("/"))
expect_apperror("فایلِ نبود", "NOT_FOUND", lambda: store.load("avatars/nope.png"))

print("\n⑦ fail-closed وقتی کلیدِ امضا نیست")
_saved = storage.settings.file_signing_secret
try:
    storage.settings.file_signing_secret = ""
    expect_apperror(
        "require_configured", "SERVER_NOT_CONFIGURED", storage.require_configured
    )
finally:
    storage.settings.file_signing_secret = _saved

print("\n" + ("نتیجه: ✅ همهٔ بررسی‌ها گذشت" if not _fails else f"نتیجه: ❌ {len(_fails)} خطا"))
sys.exit(1 if _fails else 0)
