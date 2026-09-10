"""بستهٔ لایهٔ دیتابیس.

importِ rls اینجا تضمین می‌کند که شنوندهٔ رویدادِ after_begin (تنظیم GUCِ
`app.family_id` برای RLS) به‌محضِ استفاده از لایهٔ دیتابیس ثبت شود.
"""

from __future__ import annotations

from app.db import rls as rls  # noqa: F401  (side-effect: ثبت شنوندهٔ RLS)
