"""Natural financial amounts are deterministic, exact, and never inferred from arbitrary prose."""
from decimal import Decimal

import pytest

from app.services.financial_text import (
    amount_unit,
    financial_amounts,
    normalize_financial_text,
    source_amounts,
)


@pytest.mark.parametrize(("raw", "expected"), [
    ("امروز ۲۵۰ هزار تومان برای میوه خرج کردم", "امروز 250000 تومان برای میوه خرج کردم"),
    ("دو میلیون و پانصد هزار تومان حقوق گرفتم", "2500000 تومان حقوق گرفتم"),
    ("دویست و پنجاه هزار تومان", "250000 تومان"),
    ("۱٫۵ میلیون تومان", "1500000 تومان"),
    ("پانصد ریال", "500 ریال"),
    ("خرید ۱۲٬۵۰۰ تومان", "خرید 12500 تومان"),
])
def test_narrative_money_is_normalized_only_with_an_explicit_unit(raw, expected):
    assert normalize_financial_text(raw) == expected


def test_amounts_keep_decimal_precision_and_multiple_events():
    raw = "خرید ۱۲۵۰٫۲۵ تومان و کرایه ۴۰ هزار تومان"
    assert financial_amounts(raw) == {Decimal("1250.25"), Decimal(40000)}
    assert source_amounts("برداشت ۱۲۵۰٫۲۵ تومان؛ موجودی ۵۰۰۰٫۵۰ تومان") == {Decimal("1250.25")}
    mixed = "خرید ۲۵۰ هزار تومان و حقوق ۴۰۰۰۰۰ ریال و کرایه ۲۰۰۰۰"
    assert amount_unit(mixed, Decimal(250000)) == "toman"
    assert amount_unit(mixed, Decimal(400000)) == "rial"
    assert amount_unit("خرید ۲۵۰ هزار تومان و کرایه ۲۰۰۰۰", Decimal(20000)) is None


@pytest.mark.parametrize("raw", [
    "دو تا میوه خریدم", "شاید هفته بعد خرید کنم", "رمز ۱۲۳۴۵۶",
    "شماره کارت [[ACCOUNT_A1]]", "میلیون میلیون تومان", "منفی دویست تومان",
])
def test_unrelated_or_invalid_numbers_are_not_money(raw):
    assert financial_amounts(raw) == set()
