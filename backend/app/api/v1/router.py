"""روتر نسخهٔ ۱ — همهٔ روترهای زیرمجموعه اینجا جمع می‌شوند.

فاز ۴: احراز هویت. فاز ۶: خواندنِ داده (تراکنش‌ها، حساب‌ها، دسته‌ها، پیامک، رویدادها).
فاز ۷: نوشتن (افزودن/ویرایش/حذف) کنارِ همان منابع + تنظیماتِ خانواده/پروفایلِ عضو.

نکتهٔ مرز: روت‌های «داده» (transactions/accounts/categories/sms/events) تحتِ
get_tenant_member و RLS‌اند؛ روت‌های «هویتی» (members: تنظیماتِ خانواده/پروفایل)
بیرون از RLS با get_current_member/require_owner و مرزِ لایهٔ اپ کار می‌کنند.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routes import (
    accounts,
    auth,
    categories,
    events,
    files,
    health,
    members,
    sms,
    transactions,
    uploads,
    webhooks,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
# ── دادهٔ خانواده‌محور (فاز ۶/۷) — همه تحتِ get_tenant_member و RLS ──
api_router.include_router(transactions.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(sms.router)
api_router.include_router(events.router)
# ── هویتی (فاز ۷) — بیرون از RLS: get_current_member/require_owner ──
api_router.include_router(members.router)
# ── آپلودِ فایل (فاز ۸) — هویتی (Bearer)، بیرون از RLS: استوریج جدولِ DB نیست ──
api_router.include_router(uploads.router)
# ── سرو کردنِ فایل (فاز ۸) — بدونِ احراز هویت؛ مجوز در URLِ امضاشدهٔ HMAC است ──
api_router.include_router(files.router)
# ── webhookِ ماشین-به-ماشین (فاز ۸) — بیرون از وابستگیِ RLS: احراز با «توکنِ پل»
#    در بدنه، نه نشست؛ زمینهٔ خانواده را «دستی» ست می‌کند (ingest_via_bridge). ──
api_router.include_router(webhooks.router)
