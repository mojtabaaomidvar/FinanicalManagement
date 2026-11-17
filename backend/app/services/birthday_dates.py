"""Annual Persian birthdays retain the month/day chosen in the Jalali picker."""

from __future__ import annotations

from datetime import date

import jdatetime


def _anniversary(birth: jdatetime.date, year: int) -> date:
    day = birth.day
    if birth.month == 12 and day == 30 and not jdatetime.date(year, 1, 1).isleap():
        day = 29
    return jdatetime.date(year, birth.month, day).togregorian()


def next_birthday_occurrence(birth: date, today: date) -> date:
    persian_birth = jdatetime.date.fromgregorian(date=birth)
    current_year = jdatetime.date.fromgregorian(date=today).year
    occurrence = _anniversary(persian_birth, current_year)
    if occurrence < today:
        occurrence = _anniversary(persian_birth, current_year + 1)
    return occurrence


def age_years_on_day(birth: date, today: date) -> int:
    persian_birth = jdatetime.date.fromgregorian(date=birth)
    current_year = jdatetime.date.fromgregorian(date=today).year
    before_birthday = today < _anniversary(persian_birth, current_year)
    return current_year - persian_birth.year - int(before_birthday)
