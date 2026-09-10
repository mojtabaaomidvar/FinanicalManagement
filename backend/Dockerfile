# ── خانه‌یار بک‌اند — ایمیجِ تولید (FastAPI + uvicorn) ─────────────────────────
# پلتفرمِ Docker در لیارا این ایمیج را بیلد و اجرا می‌کند؛ اپ روی پورت 8000 گوش
# می‌دهد (هم‌سان با «port» در liara.json).
#
# نکتهٔ حیاتی: مهاجرت‌های Alembic اینجا «اجرا نمی‌شوند». آن‌ها باید دستی و با ترتیبِ
# فاز ۱۰ اجرا شوند (0001 → مهاجرتِ داده → head) وگرنه RLSِ FORCE روی ۹ جدول، بارگذاریِ
# داده را می‌بندد. راهنمای اجرا در DEPLOY.md.
FROM python:3.12-slim

# خروجیِ بی‌بافر، بدونِ .pyc، بدونِ کشِ pip (ایمیجِ سبک‌تر)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# ۱) فقط وابستگی‌های زمانِ اجرا (بدونِ [dev]). ابتدا pyproject + پکیجِ app کپی می‌شود
#    تا بیلدِ hatchling کار کند. همهٔ وابستگی‌ها wheelِ آماده دارند (بدونِ نیاز به gcc).
COPY pyproject.toml ./
COPY app ./app
RUN pip install .

# ۲) فایل‌های مهاجرت + اسکریپتِ دادهٔ فاز ۱۰ (برای اجرای دستی از شلِ لیارا)
COPY alembic ./alembic
COPY alembic.ini ./
COPY migration ./migration

# ۳) کاربرِ غیرروت + پوشهٔ آپلودِ محلی (فقط در حالتِ دیسک استفاده می‌شود؛
#    در حالتِ S3 بی‌استفاده می‌ماند). اگر دیسکِ لیارا روی این مسیر mount شود،
#    باید برای این کاربر قابلِ نوشتن باشد (به DEPLOY.md بخشِ «ذخیره‌سازی» نگاه کن).
RUN useradd -m -u 10001 appuser \
 && mkdir -p /app/var/uploads \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
