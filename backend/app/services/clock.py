"""زمان مرجع (UTC، آگاه از منطقه) — یک منبع واحد برای همهٔ سرویس‌ها.

ستون‌های timestamptz در دیتابیس آگاه از منطقه‌اند؛ مقایسه باید با now آگاه انجام شود.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
