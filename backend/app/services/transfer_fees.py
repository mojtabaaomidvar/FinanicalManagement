"""Transfer tariffs supplied by the product owner; all arithmetic uses integer rials."""
from app.core.errors import AppError

TRANSFER_METHODS = {"internal", "card_to_card", "paya", "satna", "pol"}


def calculate_transfer_fee_rial(method: str, amount_rial: int, payment_count: int = 1) -> int:
    if isinstance(amount_rial, bool) or not isinstance(amount_rial, int) or amount_rial <= 0:
        raise AppError("INVALID_TRANSFER_FEE", "مبلغ انتقال باید عدد صحیح مثبت به ریال باشد.", 422)
    if method == "internal":
        return 0
    if method == "card_to_card":
        steps = (max(0, amount_rial - 10_000_000) + 9_999_999) // 10_000_000
        return 11_000 + 3_500 * steps
    if method == "paya":
        return min(120_000, max(4_000, (amount_rial + 5_000) // 10_000))
    if method == "satna":
        return min(500_000, (amount_rial + 2_500) // 5_000)
    if method == "pol":
        return max(8_000, (amount_rial + 2_500) // 5_000)
    if method == "paya_group":
        if isinstance(payment_count, bool) or not isinstance(payment_count, int) or payment_count < 1:
            raise AppError("INVALID_TRANSFER_FEE", "تعداد پرداخت‌های پایای گروهی باید عدد صحیح مثبت باشد.", 422)
        return 24_000 + 2_400 * payment_count
    raise AppError("INVALID_TRANSFER_FEE", "نوع انتقال را انتخاب کنید.", 422)
