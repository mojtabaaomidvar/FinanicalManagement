"""پارسرِ پیامکِ بانکیِ ایرانی — پورتِ منطقِ خالصِ src/shared/lib/sms-parser.ts.

چرا سمت سرور؟ تا پیش از این، پارسِ پیامک «فقط» در کلاینت (TS) انجام می‌شد و مسیرهای
مختلفِ ورودی (فورواردرِ خودکار که فقط متنِ خام را ذخیره می‌کرد، در برابر مسیرِ دستی که
سمت کلاینت پارس می‌شد) خروجیِ ناهم‌سان می‌دادند. با انتقالِ پارس به سرور، هر دو مسیرِ
ورود (خواندنِ نیتیوِ اپِ اندروید + پلِ فورواردر) دقیقاً یک‌جور تراکنش می‌سازند و وب هم
همان نتیجه را می‌بیند.

بدونِ هیچ وابستگیِ بیرونی؛ فقط کتابخانهٔ استاندارد + app.services.jalali.
منطق مو‌به‌مو با نسخهٔ TS یکی است تا در دورهٔ گذار (که هر دو زنده‌اند) اختلافی نباشد.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from app.services.jalali import to_gregorian, to_jalali

# ── ارقام فارسی/عربی → انگلیسی (معادلِ digits.ts:toEn) ───────────
_FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
_AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"
_DIGIT_MAP: dict[int, str] = {ord(c): str(i) for i, c in enumerate(_FA_DIGITS)}
_DIGIT_MAP.update({ord(c): str(i) for i, c in enumerate(_AR_DIGITS)})


def to_en(value: str) -> str:
    """ارقام فارسی/عربی → انگلیسی. سایرِ نویسه‌ها دست‌نخورده."""
    return str(value).translate(_DIGIT_MAP)


# ── بانک‌ها (ترتیب مهم است؛ اولین تطبیق برنده) ──────────────────
_BANKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"ملی|BMI|bank.?melli", re.I), "بانک ملی"),
    (re.compile(r"ملت|BMEL|tejarat.?area", re.I), "بانک ملت"),
    (re.compile(r"صادرات|BSIR|bsi", re.I), "بانک صادرات"),
    (re.compile(r"تجارت|tejarat", re.I), "بانک تجارت"),
    (re.compile(r"پاسارگاد|pasargad", re.I), "بانک پاسارگاد"),
    (re.compile(r"پارسیان|parsian", re.I), "بانک پارسیان"),
    (re.compile(r"سپه|sepah", re.I), "بانک سپه"),
    (re.compile(r"کشاورزی|keshavarzi|bki", re.I), "بانک کشاورزی"),
    (re.compile(r"رفاه|refah", re.I), "بانک رفاه"),
    (re.compile(r"مسکن|maskan", re.I), "بانک مسکن"),
    (re.compile(r"development", re.I), "بانک توسعه صادرات"),
    (re.compile(r"سامان|saman", re.I), "بانک سامان"),
    (re.compile(r"انصاری|ansari", re.I), "بانک انصاری"),
    (re.compile(r"گردشگری|tourism", re.I), "بانک گردشگری"),
    (re.compile(r"حکمت|hekmat", re.I), "بانک حکمت"),
    (re.compile(r"دی|day", re.I), "بانک دی"),
    (re.compile(r"ایران.?زمین|iranzamin", re.I), "بانک ایران‌زمین"),
    (re.compile(r"قرض.?الحسنه|qarz|mehr", re.I), "بانک قرض‌الحسنه"),
    (re.compile(r"شهر|shahr", re.I), "بانک شهر"),
    (re.compile(r"آینده|ayandeh", re.I), "بانک آینده"),
    (re.compile(r"سرمایه|sarmayeh", re.I), "بانک سرمایه"),
    (re.compile(r"کارآفرین|karafarin", re.I), "بانک کارآفرین"),
    (re.compile(r"سینا|sina", re.I), "بانک سینا"),
    (re.compile(r"مهر|mehr", re.I), "بانک مهر ایران"),
    (re.compile(r"خاورمیانه|khavarmianeh", re.I), "بانک خاورمیانه"),
]

_INCOME_WORDS = [
    "واریز",
    "واریز شد",
    "واریز به",
    "رسید",
    "رسیدید",
    "دریافت",
    "کارمزد واریز",
    "انتقال به حساب شما",
    "به حساب شما واریز",
    "deposit",
    "credited",
]

_EXPENSE_WORDS = [
    "برداشت",
    "برداشت شد",
    "پرداخت",
    "خرید",
    "انتقال",
    "پرداخت اینترنتی",
    "خرید اینترنتی",
    "کارت به کارت",
    "برداشت از",
    "پرداخت قبض",
    "شارژ",
    "withdraw",
    "purchase",
    "payment",
]

# ── الگوهای عدد/تاریخ/کلیدواژه ──────────────────────────────────
_NUM = r"(\d{1,3}(?:,\d{3})+|\d{4,})"
_AMOUNT_RE = re.compile(_NUM + r"(?:\.\d+)?")
_AMOUNT_KW_RE = re.compile(r"مبلغ[^0-9]{0,10}" + _NUM)
_BAL_MOJUDI_RE = re.compile(r"موجودی[^0-9]{0,15}" + _NUM)
_BAL_MANDE_RE = re.compile(r"مانده[^0-9]{0,15}" + _NUM)
_JALALI_RE = re.compile(r"1[34]\d{2}[/\-.](\d{1,2})[/\-.](\d{1,2})")
_GREG_RE = re.compile(r"(20\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})")
_GREG_DAYFIRST_RE = re.compile(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](20\d{2})")
_INVISIBLE_RE = re.compile(r"[‌‏‎]")

_CAT_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"قبض|برق|آب|گاز|تلفن|شارژ ماهانه"), "bills"),
    (re.compile(r"خرید|پرداخت اینترنتی|درگاه"), "shopping"),
    (re.compile(r"کارت به کارت|انتقال"), "other-e"),
    (re.compile(r"آموزش|شهریه"), "edu"),
    (re.compile(r"دارو|دکتر|بیمارستان|پزشک"), "health"),
    (re.compile(r"حقوق|salary"), "salary"),
]


@dataclass(frozen=True)
class SmsDate:
    """تاریخِ استخراج‌شده — میلادی (gy/gm/gd) به‌همراهِ معادلِ جلالی."""

    gy: int
    gm: int
    gd: int
    jalali: tuple[int, int, int]

    def to_date(self) -> date:
        """datetime.date میلادی؛ در صورتِ اجزای نامعتبر ValueError می‌دهد."""
        return date(self.gy, self.gm, self.gd)


@dataclass(frozen=True)
class ParsedSms:
    """نتیجهٔ خالصِ پارس. category ستونِ دیتابیس نیست (هنگام تبدیلِ پیامک به تراکنش
    در کلاینت به‌کار می‌رود) و صرفاً برای اطلاع برگردانده می‌شود."""

    normalized: str
    type: str | None
    bank: str | None
    amount: int | None
    balance: int | None
    date: date | None
    category: str | None


def normalize_sms(s: str) -> str:
    """ارقام فارسی/عربی → انگلیسی + ي→ی، ك→ک + حذفِ نویسه‌های نامرئی."""
    return _INVISIBLE_RE.sub("", to_en(str(s)).replace("ي", "ی").replace("ك", "ک"))


def extract_amounts(text: str) -> list[int]:
    """همهٔ اعدادِ «بزرگ» (>= ۱۰۰۰) به ترتیبِ ظهور."""
    t = to_en(text)
    out: list[int] = []
    for m in _AMOUNT_RE.finditer(t):
        v = int(m.group(1).replace(",", ""))
        if v >= 1000:
            out.append(v)
    return out


def detect_type(text: str) -> str | None:
    """رأی‌گیریِ کلیدواژه‌ای: واریز/درآمد در برابر برداشت/هزینه."""
    t = text.lower()
    income = sum(1 for w in _INCOME_WORDS if w in t)
    expense = sum(1 for w in _EXPENSE_WORDS if w in t)
    if income > expense:
        return "income"
    if expense > income:
        return "expense"
    return None


def detect_bank(text: str) -> str | None:
    for pat, name in _BANKS:
        if pat.search(text):
            return name
    return None


def extract_date(text: str) -> SmsDate | None:
    """جلالی (۱۴xx/xx/xx) → میلادی؛ وگرنه میلادیِ 20xx (سال-اول یا روز-اول)."""
    t = to_en(text)
    m = _JALALI_RE.search(t)
    if m:
        jy = int(m.group(0)[:4])
        jm, jd = int(m.group(1)), int(m.group(2))
        if 1 <= jm <= 12 and 1 <= jd <= 31:
            gy, gm, gd = to_gregorian(jy, jm, jd)
            return SmsDate(gy, gm, gd, (jy, jm, jd))
        # جلالیِ خارج از بازه: به شاخهٔ میلادی می‌افتد (مثلِ نسخهٔ TS)
    m = _GREG_RE.search(t)
    if m:
        gy, gm, gd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return SmsDate(gy, gm, gd, to_jalali(gy, gm, gd))
    m = _GREG_DAYFIRST_RE.search(t)
    if m:
        gy, gm, gd = int(m.group(3)), int(m.group(2)), int(m.group(1))
        return SmsDate(gy, gm, gd, to_jalali(gy, gm, gd))
    return None


def extract_balance(text: str) -> int | None:
    """موجودی/مانده پس از کلیدواژه (تا ۱۵ نویسهٔ غیرعددی فاصله)."""
    t = to_en(text)
    m = _BAL_MOJUDI_RE.search(t)
    if m:
        return int(m.group(1).replace(",", ""))
    m = _BAL_MANDE_RE.search(t)
    if m:
        return int(m.group(1).replace(",", ""))
    return None


def guess_category(text: str) -> str | None:
    t = text.lower()
    for pat, cat in _CAT_RULES:
        if pat.search(t):
            return cat
    return None


def parse_sms(raw_text: str) -> ParsedSms | None:
    """پارسِ کاملِ یک پیامک. None اگر متن پس از نرمال‌سازی خالی باشد.

    مبلغِ تراکنش به ترتیبِ اولویت:
      ۱) عددِ پس از کلیدواژهٔ «مبلغ» (اگر با موجودی برابر نباشد)،
      ۲) اولین عددِ بزرگِ ≠ موجودی،
      ۳) اولین عددِ بزرگ.
    """
    text = normalize_sms(raw_text or "")
    if not text:
        return None

    stype = detect_type(text)
    bank = detect_bank(text)
    sms_date = extract_date(text)
    balance = extract_balance(text)
    amounts = extract_amounts(text)

    amount: int | None = None
    kw = _AMOUNT_KW_RE.search(text)
    if kw:
        v = int(kw.group(1).replace(",", ""))
        if v != balance:
            amount = v
    if amount is None:
        tx_amounts = [a for a in amounts if a != balance]
        amount = tx_amounts[0] if tx_amounts else (amounts[0] if amounts else None)

    parsed_date: date | None = None
    if sms_date is not None:
        try:
            parsed_date = sms_date.to_date()
        except ValueError:
            parsed_date = None  # اجزای تاریخِ نامعتبر → بدونِ تاریخ (به‌جای خطا)

    return ParsedSms(
        normalized=text,
        type=stype,
        bank=bank,
        amount=amount,
        balance=balance,
        date=parsed_date,
        category=guess_category(text),
    )


def split_sms_blocks(raw: str) -> list[str]:
    """تفکیکِ چند پیامک با خطِ خالی (معادلِ splitSmsBlocks)."""
    return [b.strip() for b in re.split(r"\n\s*\n", raw) if b.strip()]
