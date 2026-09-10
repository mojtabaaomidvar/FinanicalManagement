#!/usr/bin/env python3
"""خودآزمونِ بدونِ‌دیتابیسِ پارسرِ پیامک (فاز ۸، کارِ #116).

نمونه‌های واقعیِ پیامکِ بانکیِ ایرانی را پارس می‌کند و خروجی را با انتظار می‌سنجد؛
به‌علاوه چند تبدیلِ جلالی↔میلادی را مستقیم بررسی می‌کند. بدونِ دیتابیس/شبکه.
اجرا:  python3 backend/scripts/selftest_sms_parser.py
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

# ریشهٔ backend را به مسیر اضافه کن تا import‌ها کار کنند
CANDIDATES = [
    Path("/sessions/dazzling-sweet-edison/mnt/personal-finance-pwa/backend"),
    Path.home() / "Desktop" / "personal-finance-pwa" / "backend",
    Path(__file__).resolve().parent.parent,
]
BACKEND = next((p for p in CANDIDATES if (p / "app").is_dir()), None)
if BACKEND is None:
    print("FAIL: ریشهٔ backend پیدا نشد")
    sys.exit(1)
sys.path.insert(0, str(BACKEND))

from app.services.jalali import to_gregorian, to_jalali  # noqa: E402
from app.services.sms_parser import parse_sms  # noqa: E402

fails: list[str] = []


def eq(label: str, got: object, want: object) -> None:
    if got == want:
        print(f"  ✅ {label}: {got!r}")
    else:
        print(f"  ❌ {label}: got={got!r} want={want!r}")
        fails.append(label)


# ── ۱) تبدیلِ تقویم (باید با jalali.ts یکی باشد) ─────────────────
print("① تبدیل جلالی↔میلادی")
eq("to_gregorian(1404,6,15)", to_gregorian(1404, 6, 15), (2025, 9, 6))
eq("to_gregorian(1404,7,1)", to_gregorian(1404, 7, 1), (2025, 9, 23))
eq("to_jalali(2025,9,6)", to_jalali(2025, 9, 6), (1404, 6, 15))
eq("to_jalali(2025,3,21)", to_jalali(2025, 3, 21), (1404, 1, 1))


# ── ۲) پارسِ نمونه‌های واقعی ─────────────────────────────────────
def check(label: str, raw: str, **want: object) -> None:
    print(f"\n② {label}")
    p = parse_sms(raw)
    if p is None:
        print("  ❌ parse_sms → None")
        fails.append(f"{label}:none")
        return
    for k, v in want.items():
        eq(f"{label}.{k}", getattr(p, k), v)


# برداشتِ ملی با تاریخِ جلالی
check(
    "برداشت ملی",
    "بانک ملی\nبرداشت از حساب\nمبلغ 1,250,000 ریال\nموجودی 12,300,000\n1404/06/15",
    type="expense",
    bank="بانک ملی",
    amount=1250000,
    balance=12300000,
    date=date(2025, 9, 6),
)

# واریزِ ملت با تاریخِ میلادی
check(
    "واریز ملت",
    "بانک ملت\nواریز به حساب شما\nمبلغ 5,000,000 ریال\nموجودی: 20,000,000\n2025/09/06",
    type="income",
    bank="بانک ملت",
    amount=5000000,
    balance=20000000,
    date=date(2025, 9, 6),
)

# کارت‌به‌کارتِ سامان (هزینه) با «مانده»
check(
    "کارت‌به‌کارت سامان",
    "بانک سامان\nکارت به کارت\nمبلغ 800,000\nمانده 3,200,000\n1404/06/20",
    type="expense",
    bank="بانک سامان",
    amount=800000,
    balance=3200000,
    category="other-e",
)

# حقوقِ صادرات (درآمد) — دستهٔ salary
check(
    "حقوق صادرات",
    "بانک صادرات\nحقوق واریز شد\nمبلغ 45,000,000\nموجودی 46,200,000\n1404/07/01",
    type="income",
    bank="بانک صادرات",
    amount=45000000,
    balance=46200000,
    category="salary",
    date=date(2025, 9, 23),
)

# خریدِ پارسیان با ارقامِ فارسی (آزمونِ to_en) — دستهٔ shopping
check(
    "خرید پارسیان (ارقام فارسی)",
    "بانک پارسیان خرید اینترنتی مبلغ ۱۲۰۰۰۰۰ ریال موجودی ۸۸۰۰۰۰۰",
    type="expense",
    bank="بانک پارسیان",
    amount=1200000,
    balance=8800000,
    category="shopping",
)

# پیامکِ اطلاعیِ صرفِ موجودی — نوعِ نامشخص، مبلغ=موجودی (محدودیتِ شناخته‌شده)
check(
    "اطلاعیهٔ موجودی تجارت",
    "بانک تجارت\nموجودی حساب شما 9,500,000 ریال",
    type=None,
    bank="بانک تجارت",
    balance=9500000,
    amount=9500000,
)

# مرزِ خالی‌بودن (هم‌سان با sms-parser.ts):
#   - رشتهٔ کاملاً خالی → None
#   - رشتهٔ فقط‌فاصله → شیء با همهٔ فیلدها None (TS هم trim نمی‌کند؛ خالی‌بودنِ
#     واقعی در لایهٔ ingest با strip فیلتر می‌شود)
print("\n② مرز خالی‌بودن")
eq("parse_sms('')", parse_sms(""), None)
_blank = parse_sms("   ")
eq("parse_sms('   ') not None", _blank is not None, True)
if _blank is not None:
    eq("parse_sms('   ').amount", _blank.amount, None)
    eq("parse_sms('   ').type", _blank.type, None)


# ── جمع‌بندی ─────────────────────────────────────────────────────
if fails:
    print(f"\nنتیجه: ❌ {len(fails)} شکست → {fails}")
    sys.exit(1)
print("\nنتیجه: ✅ همهٔ بررسی‌ها گذشت")
