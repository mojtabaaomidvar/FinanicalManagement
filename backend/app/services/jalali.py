"""تبدیل تقویم جلالی ↔ میلادی — پورتِ بی‌وابستگیِ src/shared/lib/jalali.ts.

فقط دو تابعِ لازمِ پارسرِ پیامک (to_gregorian / to_jalali) پورت شده‌اند تا سرور و
کلاینت روی یک متنِ یکسان «دقیقاً» یک نتیجه بدهند (پیامکِ بانکی ممکن است تاریخِ شمسی
یا میلادی داشته باشد). الگوریتم و ثابت‌ها مو‌به‌مو همان نسخهٔ TS‌اند؛ چون همهٔ عملوندها
نامنفی‌اند، Math.floor جاواسکریپت == تقسیمِ صحیحِ پایتون (//).
"""

from __future__ import annotations


def to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    """میلادی → جلالی. برابرِ toJalali در jalali.ts."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    jy = 0 if gy <= 1600 else 979
    gy -= 621 if gy <= 1600 else 1600
    gy2 = gy + 1 if gm > 2 else gy
    days = (
        365 * gy
        + (gy2 + 3) // 4
        - (gy2 + 99) // 100
        + (gy2 + 399) // 400
        - 80
        + gd
        + g_d_m[gm - 1]
    )
    jy += 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    jm = (1 + days // 31) if days < 186 else (7 + (days - 186) // 30)
    jd = 1 + (days % 31 if days < 186 else (days - 186) % 30)
    return (jy, jm, jd)


def to_gregorian(jy: int, jm: int, jd: int) -> tuple[int, int, int]:
    """جلالی → میلادی. برابرِ toGregorian در jalali.ts."""
    gy = 621 if jy <= 979 else 1600
    jy -= 0 if jy <= 979 else 979
    days = (
        365 * jy
        + (jy // 33) * 8
        + ((jy % 33) + 3) // 4
        + 78
        + jd
        + ((jm - 1) * 31 if jm < 7 else (jm - 7) * 30 + 186)
    )
    gy += 400 * (days // 146097)
    days %= 146097
    if days > 36524:
        days -= 1  # معادلِ --days در TS (پیش‌کاهش)
        gy += 100 * (days // 36524)
        days %= 36524
        if days >= 365:
            days += 1
    gy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        gy += (days - 1) // 365
        days = (days - 1) % 365
    gd = days + 1
    leap = (gy % 4 == 0 and gy % 100 != 0) or gy % 400 == 0
    sal_a = [0, 31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    gm = 1
    for gm in range(1, 13):
        if gd <= sal_a[gm]:
            break
        gd -= sal_a[gm]
    return (gy, gm, gd)
