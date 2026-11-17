"""Calendar semantics across Persian leap years and the Gregorian year boundary."""

from datetime import date

import pytest

from app.services.birthday_dates import age_years_on_day, next_birthday_occurrence


@pytest.mark.parametrize(
    ("birth", "today", "expected"),
    [
        # 1390/08/24 returns 1405/08/24, despite Gregorian leap-year drift.
        (date(2011, 11, 15), date(2026, 11, 14), date(2026, 11, 15)),
        (date(2011, 11, 15), date(2026, 11, 15), date(2026, 11, 15)),
        (date(2011, 11, 15), date(2026, 11, 16), date(2027, 11, 15)),
        # A Gregorian leap-year birth is 1391/08/25, returning on Nov 16 in 1405.
        (date(2012, 11, 15), date(2026, 11, 14), date(2026, 11, 16)),
        # 1389/10/12 is Jan 2, not Jan 1 in the next Persian year.
        (date(2011, 1, 2), date(2026, 12, 30), date(2027, 1, 2)),
        # 1399/12/30 clamps to 1400/12/29 then recovers 1403/12/30.
        (date(2021, 3, 20), date(2022, 3, 1), date(2022, 3, 20)),
        (date(2021, 3, 20), date(2025, 3, 1), date(2025, 3, 20)),
        # Gregorian Feb 29 is 1382/12/10; Persian month/day is authoritative.
        (date(2004, 2, 29), date(2027, 2, 1), date(2027, 3, 1)),
    ],
)
def test_next_birthday_keeps_jalali_month_and_day(birth, today, expected):
    assert next_birthday_occurrence(birth, today) == expected


@pytest.mark.parametrize(
    ("birth", "today", "expected"),
    [
        (date(2011, 11, 15), date(2026, 11, 14), 14),
        (date(2011, 11, 15), date(2026, 11, 15), 15),
        (date(2026, 8, 15), date(2026, 11, 15), 0),
        (date(2021, 3, 20), date(2022, 3, 19), 0),
        (date(2021, 3, 20), date(2022, 3, 20), 1),
    ],
)
def test_age_uses_the_same_persian_anniversary(birth, today, expected):
    assert age_years_on_day(birth, today) == expected
