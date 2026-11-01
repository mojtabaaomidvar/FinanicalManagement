"""مهارِ نشتِ راز در لاگ — با تمرکز بر تراسِ خطا.

چرا پروندهٔ جدا: ادعای `app/core/logging.py` این است که «هیچ توکن نشست، کلید،
یا رمزی هرگز در لاگ ظاهر نشود». تا ۲۰۲۶-۰۹-۲۸ این ادعا برای *تراس* دروغ بود:
`RedactingFilter` فقط `record.msg` را می‌شست، ولی `logging.Formatter` تراس را
از `record.exc_info` می‌سازد و **پس از** اجرای فیلترها می‌چسباند.

تست‌ها روی متنِ نهاییِ فورمتر کار می‌کنند، نه روی رکورد — چون همان چیزی است که
واقعاً روی دیسک/کنسول می‌نشیند. هیچ رازِ واقعی این‌جا نیست؛ همهٔ مقادیر ساختگی
و بی‌اثرند.
"""

from __future__ import annotations

import logging
import sys

import pytest

from app.core.logging import RedactingFilter, RedactingFormatter, scrub

_FAKE_KEY = "test-only-not-a-real-key"
_FAKE_ARGON2 = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHRzYWx0$ZmFrZWhhc2h2YWx1ZQ"
_FAKE_HEX64 = "a" * 64


def _render(record: logging.LogRecord) -> str:
    """رکورد را همان‌طور که هندلرِ واقعی می‌نویسد به متن تبدیل می‌کند."""
    RedactingFilter().filter(record)
    return RedactingFormatter("%(levelname)s %(name)s — %(message)s").format(record)


def _record_with_exception(exc: BaseException) -> logging.LogRecord:
    """رکوردی با `exc_info`ِ واقعی — تراس فقط از این راه ساخته می‌شود."""
    try:
        raise exc
    except type(exc):
        return logging.LogRecord(
            name="test",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="خطای بیرونی",
            args=(),
            exc_info=sys.exc_info(),
        )


def test_traceback_is_scrubbed_not_just_the_message() -> None:
    """رازِ داخلِ *تراس* هم ماسک می‌شود — همان چیزی که قبلاً از دست می‌رفت."""
    url = f"https://api.kavenegar.com/v1/{_FAKE_KEY}/verify/lookup.json"
    out = _render(_record_with_exception(ValueError(f"cannot reach {url}")))

    assert _FAKE_KEY not in out, out
    assert "***" in out
    # متنِ خطا و جایگاهش باید بماند؛ فقط راز می‌رود.
    assert "ValueError" in out
    assert "kavenegar.com/v1/" in out


def test_sqlalchemy_parameter_dump_is_truncated() -> None:
    """بندِ `[parameters: …]` پستگرس کاملاً بریده می‌شود.

    این بند هر ستونی می‌تواند داشته باشد — هشِ رمز، هشِ کدِ یک‌بارمصرف، هشِ
    توکنِ نشست، شمارهٔ کارت. وارسیِ الگو‌به‌الگو برایش شکننده است، پس تا پایانِ
    خط بریده می‌شود و خودِ متنِ خطا می‌ماند (قاعدهٔ ۲۳).
    """
    noisy = (
        "(psycopg.errors.UniqueViolation) duplicate key\n"
        f"[SQL: INSERT INTO members ...]\n"
        f"[parameters: ('09123456789', '{_FAKE_ARGON2}', '{_FAKE_HEX64}')]"
    )
    out = _render(_record_with_exception(RuntimeError(noisy)))

    assert _FAKE_ARGON2 not in out, out
    assert _FAKE_HEX64 not in out, out
    assert "09123456789" not in out, "شمارهٔ داخلِ بندِ پارامترها هم باید برود"
    assert "UniqueViolation" in out, "متنِ خطا نباید گم شود"


@pytest.mark.parametrize(
    "secret",
    [
        _FAKE_ARGON2,
        "$2b$12$" + "a" * 53,  # bcrypt
        _FAKE_HEX64,  # هشِ توکنِ نشست / code_hash
        "Authorization: Bearer abc.def.ghi",
        "?key=" + _FAKE_KEY,
        "api_key=" + _FAKE_KEY,
        "password=Hamid-1234",
    ],
)
def test_bare_secret_values_are_masked(secret: str) -> None:
    """هشِ رمز و توکن **بی‌برچسب** هم ماسک می‌شوند.

    در تراسِ SQLAlchemy مقادیر لخت داخلِ تاپل می‌نشینند، پس الگوهای
    برچسب‌دارِ `password=…` به‌تنهایی کافی نبودند.
    """
    cleaned = scrub(f"prefix {secret} suffix")
    assert "***" in cleaned
    for chunk in secret.split("=")[-1:]:
        if len(chunk) > 8:
            assert chunk not in cleaned, cleaned


@pytest.mark.parametrize(
    "text",
    [
        f"key={_FAKE_KEY}",  # لخت، بی‌`?`/`&`ِ پیشین
        f"params: {{'key': '{_FAKE_KEY}', 'q': 'x'}}",  # repr دیکشنری
        f'{{"key": "{_FAKE_KEY}"}}',  # JSON
        f"GET /v1/x?key={_FAKE_KEY}&y=2",
    ],
)
def test_bare_key_parameter_is_masked(text: str) -> None:
    """`key` بی‌شکلِ کوئری‌استرینگ هم ماسک می‌شود.

    الگوی نخست تنها `?key=`/`&key=` را می‌گرفت، پس لاگ‌کردنِ مستقیمِ
    دیکشنریِ پارامترها (`params: {'key': …}`) کلید را کامل بیرون می‌داد.
    """
    assert _FAKE_KEY not in scrub(text), scrub(text)


@pytest.mark.parametrize(
    "innocent",
    [
        "sortkey=name",
        "cache_key=abc123",  # زیرخط مرزِ واژه نمی‌سازد
        "primary key: id",  # نثرِ انگلیسیِ متنِ خطا
        "the key to success",
    ],
)
def test_widened_key_pattern_does_not_eat_innocent_text(innocent: str) -> None:
    """مهارِ خطای‌مثبت: واژهٔ `key` در متنِ بی‌گناه دست‌نخورده می‌ماند.

    دو قیدش عمدی است — مرزِ پیش از `key`، و کفِ ۸ نویسه برای مقدار. بی‌این
    دو، هر `primary key: id` در متنِ خطای پستگرس ماسک می‌شد و لاگ برای
    عیب‌یابی بی‌مصرف.
    """
    assert scrub(innocent) == innocent


def test_filter_neutralises_the_record_itself() -> None:
    """تورِ اول: پیام در سطحِ رکورد بی‌خطر می‌شود (برای هندلرِ ثالث)."""
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="calling %s",
        args=(f"https://api.kavenegar.com/v1/{_FAKE_KEY}/verify/lookup.json",),
        exc_info=None,
    )
    RedactingFilter().filter(record)

    assert _FAKE_KEY not in record.getMessage()
    assert record.args == ()


def test_scrub_is_idempotent() -> None:
    """دو بار شستن نباید متن را خراب کند (فیلتر و فورمتر پشتِ‌هم می‌آیند)."""
    once = scrub(f"key={_FAKE_KEY} hash={_FAKE_ARGON2}")
    assert scrub(once) == once
