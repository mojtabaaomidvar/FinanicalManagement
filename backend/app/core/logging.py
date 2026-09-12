"""پیکربندی لاگ با ردکشن اسرار/توکن.

هدف: هیچ توکن نشست، کلید، یا رمزی هرگز در لاگ ظاهر نشود (پیشگیری از نشت).
"""

from __future__ import annotations

import logging
import re

# الگوهای حساس که در متن لاگ ماسک می‌شوند
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._\-]+"), r"\1***"),
    (re.compile(r"(?i)(api[_-]?key\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    # پارامترِ لختِ `key=` در کوئری‌استرینگ (مثلاً ?key=… در آدرسِ BrsApi).
    # الگوی api_key بالا این را نمی‌گرفت و کلید کامل در لاگ می‌نشست.
    (re.compile(r"(?i)([?&]key=)[^&\s\"]+"), r"\1***"),
    (re.compile(r"(?i)(password\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    (re.compile(r"(?i)(token\"?\s*[:=]\s*\"?)[^\"\s,&]+"), r"\1***"),
    (re.compile(r"\b[a-fA-F0-9]{64}\b"), "***"),  # توکن/هش ۶۴ کاراکتری hex
]


class RedactingFilter(logging.Filter):
    """اسرار را از پیام لاگ قبل از خروجی حذف می‌کند."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        for pattern, repl in _PATTERNS:
            msg = pattern.sub(repl, msg)
        record.msg = msg
        record.args = ()
        return True


def configure_logging(debug: bool = False) -> None:
    """پیکربندی لاگ ریشه با فیلتر ردکشن."""
    level = logging.DEBUG if debug else logging.INFO
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s — %(message)s")
    )
    handler.addFilter(RedactingFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # httpx در سطحِ INFO کلِ آدرسِ درخواست را لاگ می‌کند؛ برای فراخوانیِ BrsApi
    # یعنی `?key=…` مستقیم روی دیسکِ سرور می‌نشیند. فیلترِ ردکشن آن را ماسک
    # می‌کند، ولی اتکا به یک الگوی رشته‌ای برای یک راز شکننده است — پس خودِ
    # لاگر هم به WARNING می‌رود (خطاها باقی می‌مانند، آدرس‌ها نه).
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
