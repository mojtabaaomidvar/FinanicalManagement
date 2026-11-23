"""Exact money phrases for free-form Persian input; no inferred amounts or provider instructions."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from app.services.sms_parser import normalize_sms

_WORDS = {
    "صفر": 0, "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6,
    "هفت": 7, "هشت": 8, "نه": 9, "ده": 10, "یازده": 11, "دوازده": 12,
    "سیزده": 13, "چهارده": 14, "پانزده": 15, "شانزده": 16, "هفده": 17,
    "هجده": 18, "نوزده": 19, "بیست": 20, "سی": 30, "چهل": 40, "پنجاه": 50,
    "شصت": 60, "هفتاد": 70, "هشتاد": 80, "نود": 90, "صد": 100, "یکصد": 100,
    "دویست": 200, "سیصد": 300, "چهارصد": 400, "پانصد": 500, "پونصد": 500,
    "ششصد": 600, "هفتصد": 700, "هشتصد": 800, "نهصد": 900,
}
_SCALES = {"هزار": 1000, "میلیون": 1000000, "میلیارد": 1000000000}
_NUMBER = r"\d+(?:[,٬]\d{3})*(?:[.٫]\d+)?"
_TOKEN = "(?:" + _NUMBER + "|" + "|".join((*_WORDS, *_SCALES)) + ")"
_MONEY = re.compile(
    r"(?<![\w.\-−])(?P<number>" + _TOKEN + r"(?:\s+(?:و\s+)?" + _TOKEN
    + r")*)\s+(?P<unit>تومان|ریال)(?!\w)",
)
_EXPLICIT = re.compile(r"(?<![\w.\-−])(" + _NUMBER + r")\s+(تومان|ریال)(?!\w)")
_LARGE_NUMBER = re.compile(r"(?<![\d.\-−])(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?!\d)")
_MAX_AMOUNT = Decimal("999999999999")


def _value(phrase: str) -> Decimal | None:
    total, group = Decimal(0), Decimal(0)
    last_scale = Decimal("Infinity")
    previous_number = False
    connector = False
    for word in phrase.split():
        if word == "و":
            if connector:
                return None
            connector = True
            continue
        if word in _SCALES:
            scale = Decimal(_SCALES[word])
            if scale >= last_scale:
                return None
            total += (group or 1) * scale
            group, last_scale = Decimal(0), scale
            previous_number = False
        else:
            if previous_number and not connector:
                return None
            try:
                part = Decimal(_WORDS[word]) if word in _WORDS else Decimal(
                    word.replace(",", "").replace("٬", "").replace("٫", "."),
                )
            except InvalidOperation:
                return None
            group += part
            previous_number = True
        connector = False
    value = total + group
    return value if value.is_finite() and 0 < value <= _MAX_AMOUNT else None


def _negative(prefix: str) -> bool:
    return bool(re.search(r"(?:منفی|[-−])\s*$", prefix))


def normalize_financial_text(text: str) -> str:
    # Only display/data normalization, after identifier masking; never add system instructions.
    normalized = normalize_sms(text)

    def replace(match: re.Match) -> str:
        if _negative(normalized[max(0, match.start() - 12):match.start()]):
            return match[0]
        value = _value(match["number"])
        if value is None:
            return match[0]
        amount = format(value, "f").rstrip("0").rstrip(".") if "." in str(value) else str(value)
        return amount + " " + match["unit"]

    return _MONEY.sub(replace, normalized)


def financial_amounts(text: str) -> set[Decimal]:
    normalized = normalize_financial_text(text)
    result: set[Decimal] = set()
    for match in _EXPLICIT.finditer(normalized):
        prefix = normalized[max(0, match.start() - 24):match.start()]
        if _negative(prefix) or re.search(r"(?:موجودی|مانده)[^\d]{0,20}$", prefix):
            continue
        value = _value(match[1])
        if value is not None:
            result.add(value)
    return result


def source_amounts(text: str) -> set[Decimal]:
    """Legacy unlabelled SMS amounts plus explicit money, without truncating decimal values."""
    normalized = normalize_financial_text(text)
    result = financial_amounts(normalized)
    for match in _LARGE_NUMBER.finditer(normalized):
        prefix = normalized[max(0, match.start() - 24):match.start()]
        if _negative(prefix) or re.search(r"(?:موجودی|مانده)[^\d]{0,20}$", prefix):
            continue
        value = _value(match[0])
        if value is not None and value >= 1000:
            result.add(value)
    return result


def amount_unit(text: str, amount: Decimal | None) -> str | None:
    """Tie each explicit currency to its own exact value, not another event's unit."""
    if amount is None:
        return None
    normalized = normalize_financial_text(text)
    units = set()
    for match in _EXPLICIT.finditer(normalized):
        prefix = normalized[max(0, match.start() - 24):match.start()]
        if _negative(prefix) or re.search(r"(?:موجودی|مانده)[^\d]{0,20}$", prefix):
            continue
        if _value(match[1]) == amount:
            units.add("rial" if match[2] == "ریال" else "toman")
    return next(iter(units)) if len(units) == 1 else None
