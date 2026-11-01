"""پیکربندی برنامه — فقط از متغیرهای محیطی خوانده می‌شود.

هیچ مقدار حساسی اینجا مقداردهی پیش‌فرض نمی‌شود؛ اسرار باید از .env / محیط بیایند.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── عمومی ─────────────────────────────────────────────
    app_env: str = "development"
    debug: bool = False

    # ── دیتابیس ───────────────────────────────────────────
    database_url: str = "postgresql+psycopg://localhost:5432/khaneyar"

    # ── CORS (رشتهٔ جداشده با کاما؛ بدون '*') ──────────────
    cors_origins: str = ""

    # ── نشست‌ها ───────────────────────────────────────────
    session_token_bytes: int = 32          # ۳۲ بایت = ۶۴ کاراکتر hex
    session_sliding_days: int = 7
    session_absolute_days: int = 90

    # ── OTP و ضد brute-force ──────────────────────────────
    otp_ttl_seconds: int = 300             # ۵ دقیقه — یکسان با سرور (رفع D-8)
    otp_max_attempts: int = 5
    brute_force_max_fails: int = 10
    brute_force_window_minutes: int = 15

    # ── سقفِ نرخِ per-IP روی مسیرهای عمومیِ احراز (§5.11 — رفعِ شکافِ #۱۵) ──
    # چرا per-IP و نه فقط per-phone؟ شمارندهٔ auth_attempts با «شماره» کلید می‌خورد،
    # پس مهاجمی که یک رمزِ رایج را روی هزار شمارهٔ مختلف می‌آزماید (credential
    # stuffing) هیچ‌وقت به سقف نمی‌خورد. این سقف‌ها آن محور را می‌بندند.
    #
    # نشانیِ IP خام هرگز ذخیره نمی‌شود؛ فقط HMAC-SHA256ِ نمک‌خورده (سرویس ratelimit).
    rate_limit_salt: str = ""              # «راز»؛ خالی = برگشت به file_signing_secret
    trusted_proxy_ips: str = ""            # خالی = اعتماد به peerِ loopback/خصوصی
    rl_window_seconds: int = 60            # پنجرهٔ همهٔ سقف‌های per-IP زیر
    rl_login_per_ip: int = 30              # POST /auth/login
    rl_check_password_per_ip: int = 30     # POST /auth/check-password (اوراکلِ رمز)
    rl_pre_registered_per_ip: int = 10     # POST /auth/pre-registered (اوراکلِ شماره)
    rl_join_per_ip: int = 8                # POST /auth/join — کدِ ۶رقمی حدس‌زدنی است
    rl_register_per_ip: int = 5            # POST /auth/register
    rl_otp_request_per_ip: int = 5         # POST /auth/otp/request
    rl_password_reset_per_ip: int = 5      # مسیرِ فراموشیِ رمز (§9.5)

    # ── Argon2id ──────────────────────────────────────────
    argon2_time_cost: int = 3
    argon2_memory_cost: int = 65536        # کیلوبایت (۶۴ مگابایت)
    argon2_parallelism: int = 4

    # ── پیامک (خروجی — کدِ یک‌بارمصرف) ─────────────────────
    # تا وقتی sms_api_key خالی است، فرستنده «خنثی» است: چیزی ارسال نمی‌شود، هیچ
    # خطایی هم بالا نمی‌رود (فقط لاگِ بی‌نامِ رخداد). فعال‌سازی فقط با پرکردنِ
    # این چهار کلید در .envِ تولید — هیچ کلیدی در مخزن نوشته نمی‌شود.
    sms_provider: str = ""                 # خالی = خنثی. مقدارِ شناخته‌شده: kavenegar
    sms_api_key: str = ""                  # «راز» — کاوه‌نگار آن را در *مسیرِ URL* می‌گذارد
    sms_sender: str = ""                   # خطِ ارسال؛ فقط برای پیامکِ متنِ آزاد
    sms_template: str = ""                 # نامِ قالبِ verify/lookup؛ پرشده = مسیرِ ترجیحی
    sms_timeout_seconds: float = 6.0       # هم‌سان با تایم‌اوتِ market

    # ── بازیابیِ رمز (§9.5) ────────────────────────────────
    # چرا جدا از otp_ttl_seconds؟ ۵ دقیقه برای «پیامک را ببین، به نرم‌افزار برگرد،
    # کد را بزن، رمزِ تازه را دو بار بنویس» تنگ است و کاربر را به تکرارِ درخواست
    # می‌اندازد. ۱۵ دقیقه هم برای کدِ ۶رقمی با سقفِ ۵ حدس امن است.
    password_reset_ttl_seconds: int = 900

    # ── بازار (BrsApi — طلا/ارز و شاخص بورس) ───────────────
    brsapi_key: str = ""                  # خالی = ماژول بازار غیرفعال
    market_cache_seconds: int = 300       # TTL کش سرور-سمتی (سقف رایگان: ۱۵۰۰/۱۰۰۰ درخواست در روز)

    # ── ذخیره‌سازی آبجکت (S3-compatible) ──────────────────
    # اگر storage_endpoint و storage_bucket هر دو ست شوند → backend S3 فعال می‌شود؛
    # وگرنه دیسک محلی (storage_dir). غیرمخرب و سازگار عقب‌رو.
    storage_endpoint: str = ""             # مثل https://storage.iran.liara.space
    storage_bucket: str = ""               # نام باکت واقعی (مثل khaneyar-files)
    storage_bucket_avatars: str = "avatars"    # پیشوند کلید داخل باکت
    storage_bucket_photos: str = "tx-photos"   # پیشوند کلید داخل باکت
    storage_access_key: str = ""
    storage_secret_key: str = ""
    storage_region: str = "us-east-1"      # فقط برای امضای SigV4 (endpoint مسیر را تعیین می‌کند)

    # ── فایل‌های آپلودی: ذخیرهٔ دیسک محلی + URL امضاشدهٔ HMAC (فاز ۸) ──
    # جایگزین باکت‌های «عمومی» Supabase. بایت‌ها زیر storage_dir ذخیره و از راه
    # GET /api/v1/files/{path}?sig=... سرو می‌شوند؛ امضا با file_signing_secret.
    storage_dir: str = "./var/uploads"     # ریشهٔ ذخیره روی دیسک
    files_base_url: str = ""               # پیشوند URL عمومی؛ خالی = نسبی (هم‌مبدأ)
    file_signing_secret: str = ""          # کلید HMAC URLها — «راز»، فقط از محیط
    upload_max_bytes: int = 1_050_000      # ~۱MB پس از دیکود (هم‌سان با سقف قبلی)

    @property
    def cors_origins_list(self) -> list[str]:
        """فهرست منشأهای مجاز CORS از رشتهٔ کامایی."""
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_proxy_list(self) -> list[str]:
        """فهرست IPهای پروکسیِ مورد اعتماد (برای خواندنِ X-Real-IP)."""
        return [p.strip() for p in self.trusted_proxy_ips.split(",") if p.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    """نمونهٔ واحد و کش‌شدهٔ تنظیمات."""
    return Settings()


settings = get_settings()
