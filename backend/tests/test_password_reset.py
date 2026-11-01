"""مرزهای «فراموشیِ رمز» (§9.5) — شکافِ #۱۴ در ممیزیِ ۱۴۰۵/۰۷/۰۱.

این پرونده رفتارِ دو اندپوینتِ `POST /auth/password-reset/{request,confirm}` را
قفل می‌کند. هر تست عمداً یک *تصمیمِ امنیتیِ مستند* را می‌سنجد، نه «کار می‌کند یا
نه»؛ پس اگر روزی کسی آن تصمیم را ساده‌سازی کند، همین‌جا سرخ می‌شود.

## چرا صندوقِ خروجی (`outbox`) لازم است
کدِ بازیابی نه در پاسخِ HTTP می‌آید (که همان چیزی است که این مسیر را از
اوراکلِ شمارشِ حساب جدا می‌کند) و نه در دیتابیس به‌شکلِ خام ذخیره می‌شود (از
مهاجرتِ `0008` به بعد فقط `code_hash` است). پس تنها نقطهٔ گرفتنِ کد، همان درزِ
ارسال است: `sms.deliver_code` را با یک ضبط‌کننده جا‌به‌جا می‌کنیم.

دو دلیل که این کار درست است و «تست به پیاده‌سازی چسبیده» نیست:

* `services/password_reset.py` تابع را در لحظهٔ `background.add_task` از خودِ
  ماژول می‌خواند (`sms.deliver_code`)، پس جا‌به‌جایی روی ماژول اثر می‌گذارد.
* `TestClient` کارهای پس‌زمینه را **پیش از بازگشتِ پاسخ** اجرا می‌کند، پس وقتی
  `client.post(...)` برمی‌گردد صندوق پُر است.

## هیچ کلیدِ واقعیِ پیامکی اینجا نیست
هر جا کلید لازم است مقدارِ بی‌اثرِ تستی گذاشته می‌شود و **هیچ درخواستِ شبکه‌ای**
زده نمی‌شود: تنها چیزی که سنجیده می‌شود انتخابِ آداپتور است، نه ارسالِ واقعی.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import (
    AUTH,
    PASSWORD,
    Actor,
    accept_invite,
    create_invite_token,
    login_as,
    next_phone,
)

_NEW_PASSWORD = "Tazeh-Passw0rd"
_UNKNOWN_PHONE = "09999999999"


# ── ابزارها ──────────────────────────────────────────────────────
@pytest.fixture()
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, str]]:
    """درزِ ارسالِ پیامک را با یک ضبط‌کننده جا‌به‌جا می‌کند.

    خروجیِ `True` را تقلید می‌کند چون `deliver_code` قرارِ «هرگز خطا بالا نبر»
    دارد و صفِ پس‌زمینه هیچ مصرف‌کنندهٔ دیگری برای مقدارش ندارد.
    """
    from app.services import sms

    sent: list[dict[str, str]] = []

    def _capture(phone: str, code: str, *, purpose: str) -> bool:
        sent.append({"phone": phone, "code": code, "purpose": purpose})
        return True

    monkeypatch.setattr(sms, "deliver_code", _capture)
    return sent


@pytest.fixture()
def db_session(client: Any) -> Iterator[Any]:
    """نشستِ خامِ دیتابیسِ تست — برای کارهایی که از راهِ HTTP شدنی نیست.

    وابستگی به `client` عمدی است: هم لایهٔ دیتابیس را import می‌کند و هم تضمین
    می‌دهد `clean_tables` پیش از ساختنِ نشست اجرا شده باشد.
    """
    from app.db.session import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _request_reset(client: Any, phone: str) -> Any:
    return client.post(f"{AUTH}/password-reset/request", json={"phone": phone})


def _confirm_reset(client: Any, phone: str, code: str, new_password: str) -> Any:
    return client.post(
        f"{AUTH}/password-reset/confirm",
        json={"phone": phone, "code": code, "new_password": new_password},
    )


def _one_code(outbox: list[dict[str, str]], phone: str) -> str:
    """تنها کدِ ضبط‌شده برای این شماره. اگر صفر یا چند تا بود، تست می‌شکند."""
    codes = [m["code"] for m in outbox if m["phone"] == phone]
    assert len(codes) == 1, f"انتظار یک کد برای {phone} بود، ضبط‌شده: {outbox}"
    return codes[0]


# ── گامِ ۱: هیچ خبری از وجود یا نبودِ شماره ──────────────────────
def test_request_is_identical_for_unknown_phone(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """پاسخِ شمارهٔ ثبت‌شده و ثبت‌نشده باید *یکسان* باشد (ضدِ شمارشِ حساب).

    این تستِ محوریِ §۹.۵ است: اگر روزی کسی برای شمارهٔ ناشناس `404` یا پیامِ
    «کاربر یافت نشد» بگذارد، همین‌جا می‌شکند. اثرِ جانبی (ارسالِ کد) فقط برای
    شمارهٔ واقعی رخ می‌دهد، ولی از بیرون دیده نمی‌شود.
    """
    known = _request_reset(client, home_a.phone)
    unknown = _request_reset(client, _UNKNOWN_PHONE)

    assert known.status_code == unknown.status_code == 200, (known.text, unknown.text)
    assert known.json() == unknown.json() == {"ok": True}

    assert [m["phone"] for m in outbox] == [home_a.phone]
    assert outbox[0]["purpose"] == "password_reset"


def test_request_body_never_carries_the_code(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """بدنهٔ پاسخ فقط `ok` دارد — کد **هرگز** برنمی‌گردد، حتی در توسعه.

    مسیرِ ورود در حالتِ توسعه کد را برمی‌گرداند (`/auth/otp/request`)، و همین
    وسوسه یک بار هم اینجا پیش آمد. اگر کسی «برای راحتیِ تست» کد را به پاسخ
    اضافه کند، مسیرِ بازیابی دوباره اوراکلِ شمارشِ حساب می‌شود: پاسخِ شمارهٔ
    ثبت‌شده و ثبت‌نشده دیگر یکسان نیست.
    """
    res = _request_reset(client, home_a.phone)

    assert res.status_code == 200, res.text
    assert set(res.json()) == {"ok"}, res.text

    code = _one_code(outbox, home_a.phone)
    assert code not in res.text


def test_cooldown_is_silent(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """درخواستِ دوم در کول‌داون هم `200` می‌گیرد، ولی کدِ تازه‌ای صادر نمی‌شود.

    تصمیمِ ۱ در `services/password_reset.py`: اگر مثلِ مسیرِ ورود `TOO_SOON/429`
    می‌داد، شمارهٔ ثبت‌شده ۴۲۹ می‌گرفت و ثبت‌نشده ۲۰۰ — یعنی خودِ محدودیتِ نرخ
    می‌شد ابزارِ شمارشِ حساب. کاربرِ نهایی این سکوت را از شمارندهٔ ۶۰ ثانیه‌ایِ
    کلاینت می‌فهمد، نه از خطای سرور.
    """
    first = _request_reset(client, home_a.phone)
    second = _request_reset(client, home_a.phone)

    assert first.json() == second.json() == {"ok": True}
    assert first.status_code == second.status_code == 200
    assert len(outbox) == 1, f"کول‌داون کدِ دوم را نگرفت: {outbox}"


def test_pending_member_can_still_reset(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """عضوِ در انتظارِ تأیید هم کدِ بازیابی می‌گیرد — و بعدش هم وارد نمی‌شود.

    عمدی است: مرجعِ «حقِ ورود» گیتِ `_ensure_can_login` در زمانِ ورود است، نه
    مسیرِ بازیابی. بستنِ بازیابی برای عضوِ pending فقط یک بن‌بست می‌ساخت
    (رمزش را فراموش کرده و تا ابد هم نمی‌تواند عوضش کند)، بی‌هیچ سودِ امنیتی.
    """
    token = create_invite_token(client, home_a)
    phone = next_phone()
    joined = accept_invite(client, token, name="فرزند", phone=phone)
    assert joined.status_code == 200, joined.text

    assert _request_reset(client, phone).status_code == 200
    code = _one_code(outbox, phone)
    assert _confirm_reset(client, phone, code, _NEW_PASSWORD).status_code == 200

    # رمز عوض شد، ولی گیتِ عضویت سرِ جایش است: ۴۰۳ نه ۴۰۱.
    blocked = client.post(
        f"{AUTH}/login", json={"phone": phone, "password": _NEW_PASSWORD}
    )
    assert blocked.status_code == 403, blocked.text
    assert blocked.json()["error"] == "MEMBERSHIP_PENDING"


# ── گامِ ۲: مصرفِ کد و پیامدهایش ─────────────────────────────────
def test_confirm_changes_password_and_revokes_every_session(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """رمزِ تازه می‌نشیند، **همهٔ** نشست‌ها باطل می‌شوند، و نشستِ نو صادر نمی‌شود.

    سه قفل در یک تست، چون هر سه یک تصمیم‌اند (تصمیمِ ۴): فرضِ بازیابی این است
    که رمزِ قبلی از دستِ کاربر خارج شده، پس هر نشستِ بازِ دیگری هم مشکوک است.
    اگر کسی `logout_all` را به `revoke_others` تغییر دهد (مثلِ `change_password`)،
    نشستِ دزدیده‌شده از بازیابی جان سالم می‌برد و این تست می‌شکند.
    """
    second = login_as(client, home_a.phone)  # نشستِ دومِ همان عضو

    assert _request_reset(client, home_a.phone).status_code == 200
    code = _one_code(outbox, home_a.phone)

    done = _confirm_reset(client, home_a.phone, code, _NEW_PASSWORD)
    assert done.status_code == 200, done.text
    # پاسخ نشست نمی‌دهد: کاربر باید از مسیرِ عادیِ ورود بیاید تا گیتِ عضویت
    # (§2.6) هم اعمال شود.
    assert set(done.json()) == {"ok"}, done.text

    for stale in (home_a, second):
        expired = client.get(f"{AUTH}/session", headers=stale.h)
        assert expired.status_code == 401, expired.text
        assert expired.json()["error"] == "SESSION_EXPIRED"

    old = client.post(f"{AUTH}/login", json={"phone": home_a.phone, "password": PASSWORD})
    assert old.status_code == 401, old.text
    assert old.json()["error"] == "INVALID_CREDENTIALS"

    fresh = login_as(client, home_a.phone, _NEW_PASSWORD)
    assert fresh.token and fresh.token != home_a.token


def test_confirm_needs_the_code_even_when_otp_is_disabled(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """کدِ غلط رد می‌شود، هرچند پرچمِ `otp_enabled` خاموش است.

    تصمیمِ ۳: این مسیر `verify_and_consume` را صدا می‌زند نه `consume_otp`.
    دومی وقتی پرچمِ ورود خاموش است بی‌هیچ بررسی‌ای رد می‌شود — روی مسیرِ
    بازیابی یعنی «هرکس با هر شماره‌ای رمزِ هرکس را عوض کند». در همین مجموعهٔ
    تست پرچم خاموش است، پس اگر کسی به `consume_otp` برگردد، این تست فوراً
    سرخ می‌شود (و رمز هم واقعاً عوض شده بود).
    """
    assert _request_reset(client, home_a.phone).status_code == 200
    real = _one_code(outbox, home_a.phone)
    wrong = "000000" if real != "000000" else "111111"

    res = _confirm_reset(client, home_a.phone, wrong, _NEW_PASSWORD)
    assert res.status_code == 400, res.text
    assert res.json()["error"] == "INVALID_OTP"

    # رمزِ قدیم هنوز کار می‌کند؛ رمزِ تازه نه.
    assert login_as(client, home_a.phone).token
    refused = client.post(
        f"{AUTH}/login", json={"phone": home_a.phone, "password": _NEW_PASSWORD}
    )
    assert refused.status_code == 401, refused.text


def test_unknown_phone_gets_the_same_error_as_a_wrong_code(client: Any) -> None:
    """گامِ ۲ هم نشتی ندارد: شمارهٔ ثبت‌نشده همان `INVALID_OTP` را می‌گیرد.

    این «اتفاقی» درست است، نه یک شرطِ اضافه: شمارهٔ ناشناس هیچ کدی ندارد، پس
    بررسی طبیعتاً شکست می‌خورد. تست برای این است که اگر کسی روزی برای
    خوش‌خوانیِ خطا شرطی مثلِ «عضو یافت نشد» اضافه کند، تفاوت دیده شود.
    """
    res = _confirm_reset(client, _UNKNOWN_PHONE, "123456", _NEW_PASSWORD)
    assert res.status_code == 400, res.text
    assert res.json()["error"] == "INVALID_OTP"


def test_code_is_single_use(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """کد یک‌بارمصرف است — بارِ دوم `INVALID_OTP`."""
    assert _request_reset(client, home_a.phone).status_code == 200
    code = _one_code(outbox, home_a.phone)

    assert _confirm_reset(client, home_a.phone, code, _NEW_PASSWORD).status_code == 200

    again = _confirm_reset(client, home_a.phone, code, "Digar-Passw0rd")
    assert again.status_code == 400, again.text
    assert again.json()["error"] == "INVALID_OTP"
    # و رمز هم همان اولی مانده است.
    assert login_as(client, home_a.phone, _NEW_PASSWORD).token


def test_login_purpose_code_is_rejected_for_reset(
    client: Any,
    home_a: Actor,
    outbox: list[dict[str, str]],
    db_session: Any,
) -> None:
    """کدِ «ورود» رمز را عوض نمی‌کند، و کدِ «بازیابی» را هم پاک نمی‌کند.

    همان purpose confusionی که مهاجرتِ `0008` بست: پیش از آن، کدی که برای ورود
    پیامک شده بود می‌توانست رمز را عوض کند (تسخیرِ حساب)، و درجِ هر کد کدِ
    جریانِ دیگر را هم پاک می‌کرد. هر دو نیمه اینجا قفل می‌شوند.
    """
    from app.models.auth import PURPOSE_LOGIN
    from app.services import otp as otp_service

    assert _request_reset(client, home_a.phone).status_code == 200
    reset_code = _one_code(outbox, home_a.phone)

    login_code = "654321" if reset_code != "654321" else "123456"
    otp_service.insert_otp(db_session, home_a.phone, login_code, purpose=PURPOSE_LOGIN)

    refused = _confirm_reset(client, home_a.phone, login_code, _NEW_PASSWORD)
    assert refused.status_code == 400, refused.text
    assert refused.json()["error"] == "INVALID_OTP"

    # نیمهٔ دوم: کدِ بازیابی زنده مانده است.
    ok = _confirm_reset(client, home_a.phone, reset_code, _NEW_PASSWORD)
    assert ok.status_code == 200, ok.text


# ── اعتبارسنجیِ ورودی ────────────────────────────────────────────
def test_weak_password_does_not_burn_the_code(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """رمزِ کوتاه `422` می‌گیرد و کدِ درست را نمی‌سوزاند.

    ترتیبِ عمدیِ `confirm_reset` (سقفِ نرخ → طولِ رمز → مصرفِ کد) و
    `min_length` در اسکیما هر دو برای همین‌اند: یک اشتباهِ تایپی در رمز نباید
    کاربر را مجبور کند دوباره کد بگیرد (که با کول‌داونِ ۶۰ ثانیه یعنی یک
    دقیقه انتظار).
    """
    assert _request_reset(client, home_a.phone).status_code == 200
    code = _one_code(outbox, home_a.phone)

    weak = _confirm_reset(client, home_a.phone, code, "Ab3")
    assert weak.status_code == 422, weak.text

    # پاکتِ خطا: کدِ ماشینی + نامِ فیلدها، بی‌هیچ مقداری از ورودی.
    body = weak.json()
    assert body["error"] == "INVALID_INPUT"
    assert body["fields"] == ["new_password"]
    assert "Ab3" not in weak.text, "رمزِ کاربر در بدنهٔ خطا بازتابیده شد (§۵)"

    # همان کد، این بار با رمزِ معتبر.
    assert _confirm_reset(client, home_a.phone, code, _NEW_PASSWORD).status_code == 200


def test_malformed_code_is_rejected_by_the_schema(client: Any, home_a: Actor) -> None:
    """کدِ غیرِ ۶‌رقمی به سرویس نمی‌رسد — `422` با نامِ فیلد.

    سودِ امنیتی‌اش این است که ورودی‌های بی‌شکل شمارندهٔ تلاشِ ناموفقِ شماره را
    بالا نمی‌برند و کاربر را بی‌دلیل قفل نمی‌کنند.
    """
    res = _confirm_reset(client, home_a.phone, "12", _NEW_PASSWORD)
    assert res.status_code == 422, res.text
    assert res.json()["fields"] == ["code"]


# ── محرمانگیِ ذخیره‌سازی ─────────────────────────────────────────
def test_code_is_stored_hashed_with_its_purpose(
    client: Any, home_a: Actor, outbox: list[dict[str, str]], raw_sql: Any
) -> None:
    """در `otp_codes` فقط هشِ فلفل‌خورده می‌نشیند، با هدفِ `password_reset`.

    §۵.۱۱ ذخیرهٔ برگشت‌پذیرِ اعتبارنامه را منع می‌کند و کدِ یک‌بارمصرف عملاً یک
    اعتبارنامه است؛ پیش از مهاجرتِ `0008` همین ستون خامِ کد را نگه می‌داشت.
    """
    from app.services import otp as otp_service

    assert _request_reset(client, home_a.phone).status_code == 200
    code = _one_code(outbox, home_a.phone)

    rows = raw_sql.execute(
        text("SELECT phone, purpose, code_hash FROM otp_codes WHERE phone = :p"),
        {"p": home_a.phone},
    ).all()
    assert len(rows) == 1, rows

    phone, purpose, code_hash = rows[0]
    assert purpose == "password_reset"
    assert code_hash == otp_service.hash_code(code)
    assert len(code_hash) == 64 and all(c in "0123456789abcdef" for c in code_hash)
    assert code not in code_hash
    assert phone == home_a.phone


# ── سقفِ نرخ ─────────────────────────────────────────────────────
def test_per_ip_limit_uses_separate_buckets_for_the_two_steps(
    client: Any, home_a: Actor, outbox: list[dict[str, str]], rate_limit: Any
) -> None:
    """سقفِ per-IP می‌گیرد، ولی گامِ ۱ و گامِ ۲ سطلِ مشترک ندارند.

    دو `kind` جدا (`password_reset` و `password_reset_confirm`) عمدی است:
    کاربری که کد را چند بار اشتباه می‌زند نباید از «درخواستِ کدِ تازه» هم محروم
    شود، و برعکس. سقف روی «هر درخواست» است نه «هر شکست»، پس شمارش با درخواستِ
    موفق هم بالا می‌رود.
    """
    rate_limit(password_reset_per_ip=2)

    assert _request_reset(client, home_a.phone).status_code == 200
    assert _request_reset(client, _UNKNOWN_PHONE).status_code == 200

    blocked = _request_reset(client, home_a.phone)
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["error"] == "TOO_MANY_ATTEMPTS"

    # سطلِ گامِ ۲ دست‌نخورده است: پاسخ ۴۰۰ (کدِ غلط) است نه ۴۲۹.
    other = _confirm_reset(client, home_a.phone, "123456", _NEW_PASSWORD)
    assert other.status_code == 400, other.text
    assert other.json()["error"] == "INVALID_OTP"


def test_rate_limit_stores_no_raw_ip_for_this_route(
    client: Any, home_a: Actor, outbox: list[dict[str, str]], rate_limit: Any, raw_sql: Any
) -> None:
    """کلیدِ سطل هشِ نمک‌خوردهٔ نشانی است، نه خودِ نشانی (§۵ — لاگِ بی‌نشت).

    همان قاعدهٔ `test_rate_limit.py`، این بار روی دو `kind`ِ تازه؛ چون شمارندهٔ
    تازه‌ای اضافه شده و افزودنِ شمارنده جای آسانی برای برگشتنِ IPِ خام است.
    """
    rate_limit(password_reset_per_ip=5)
    assert _request_reset(client, home_a.phone).status_code == 200

    rows = raw_sql.execute(
        text("SELECT scope FROM lookup_attempts WHERE kind = 'password_reset'")
    ).all()
    assert rows, "هیچ ردی از شمارشِ سقفِ نرخ ثبت نشد"
    for (scope,) in rows:
        assert "." not in scope and ":" not in scope, f"scope شکلِ IP دارد: {scope}"
        assert len(scope) == 32, f"scope باید هشِ ۳۲هگزی باشد: {scope}"
        int(scope, 16)  # اگر هگز نباشد ValueError می‌دهد


# ── صداقتِ پرچمِ سرور ────────────────────────────────────────────
def test_config_flag_and_request_gate_share_one_source(
    client: Any, home_a: Actor, monkeypatch: pytest.MonkeyPatch
) -> None:
    """`/auth/config` و گیتِ `request_reset` هر دو از `is_available()` می‌آیند.

    در توسعه (بی‌کلید) مسیر کار می‌کند، چون `NullSmsSender` کد را در لاگ
    می‌گذارد. در تولیدِ بی‌کلید نه: کد ساخته می‌شد ولی به دستِ هیچ‌کس نمی‌رسید و
    «۲۰۰ خالی» آنجا یعنی دروغ. اگر این دو مصرف‌کننده از هم جدا شوند، دکمهٔ
    «فراموشیِ رمز» در کلاینت ظاهر می‌شود و جز ۵۰۳ چیزی نمی‌دهد.
    """
    from app.core.config import settings

    # این تست عمداً `outbox` نمی‌گیرد: می‌خواهیم مسیر با «خودِ» `deliver_code`
    # طی شود تا معلوم شود فرستندهٔ خنثی در صفِ پس‌زمینه اندپوینت را نمی‌شکند.
    # (`TestClient` خطای کارِ پس‌زمینه را بالا می‌آورد، پس این واقعاً سنجیده می‌شود.)
    dev = client.get(f"{AUTH}/config")
    assert dev.status_code == 200, dev.text
    assert dev.json()["password_reset_enabled"] is True
    assert _request_reset(client, home_a.phone).status_code == 200

    # تولیدِ بی‌کلید — تنها حالتی که مسیر باید خودش را خاموش اعلام کند.
    monkeypatch.setattr(settings, "app_env", "production")

    off = client.get(f"{AUTH}/config")
    assert off.json()["password_reset_enabled"] is False, off.text

    refused = _request_reset(client, next_phone())
    assert refused.status_code == 503, refused.text
    assert refused.json()["error"] == "SMS_NOT_CONFIGURED"


def test_config_exposes_nothing_beyond_two_flags(client: Any) -> None:
    """پیکربندیِ عمومی بی‌نشست خوانده می‌شود، پس دقیقاً دو پرچم دارد و بس.

    هر کلیدِ تازه‌ای اینجا بی‌احراز هویت بیرون می‌رود؛ این تست آن را یک تصمیمِ
    آگاهانه می‌کند نه یک اتفاق.
    """
    res = client.get(f"{AUTH}/config")
    assert res.status_code == 200, res.text
    assert set(res.json()) == {"otp_enabled", "password_reset_enabled"}


# ── خنثی‌بودنِ درگاه بی‌کلید ─────────────────────────────────────
def test_sender_is_inert_without_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """بی‌کلید: فرستندهٔ خنثی، بی‌شبکه، بی‌خطا — و فعال‌سازی فقط با `.env`.

    قرارِ کلیدیِ این درز: مخزن بی‌هیچ کلیدی قابلِ اجرا و تست است و روشن‌شدنِ
    تولید *تنها* با پرکردنِ `SMS_API_KEY` رخ می‌دهد. مقدارِ زیر تستی و بی‌اثر
    است و هیچ درخواستِ شبکه‌ای هم زده نمی‌شود: فقط انتخابِ آداپتور سنجیده
    می‌شود.
    """
    from app.core.config import settings
    from app.services import sms

    monkeypatch.setattr(settings, "sms_api_key", "")
    assert sms.is_configured() is False
    assert isinstance(sms.get_sender(), sms.NullSmsSender)
    # `deliver_code` هرگز خطا بالا نمی‌برد؛ بی‌کلید هم «موفق» گزارش می‌شود.
    assert sms.deliver_code("09120000000", "123456", purpose="password_reset") is True

    monkeypatch.setattr(settings, "sms_api_key", "test-only-not-a-real-key")
    monkeypatch.setattr(settings, "sms_provider", "kavenegar")
    assert sms.is_configured() is True
    assert isinstance(sms.get_sender(), sms.KavenegarSender)

    # درگاهِ ناشناس نباید ارسالِ بی‌ادعا بکند؛ به خنثی برمی‌گردد.
    monkeypatch.setattr(settings, "sms_provider", "some-unknown-gateway")
    assert isinstance(sms.get_sender(), sms.NullSmsSender)


def test_unknown_provider_is_not_reported_as_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """کلیدِ پر + درگاهِ غلط = «پیکربندی‌نشده»، نه «پیکربندی‌شدهٔ خراب».

    این همان حالتی است که تا ۲۰۲۶-۰۹-۲۸ از دست می‌رفت: `is_configured` فقط
    خالی‌نبودنِ کلید را می‌سنجید، پس با یک `SMS_PROVIDER`ِ غلط‌نوشته روی تولید
    مسیر خودش را «روشن» اعلام می‌کرد، دکمه در کلاینت دیده می‌شد، کد ساخته
    می‌شد، کاربر «۲۰۰ خالی» می‌گرفت — و هیچ پیامکی نمی‌رفت. یعنی دقیقاً همان
    دروغی که کامنتِ `request_reset` می‌گوید جلوش را گرفته است.
    """
    from app.core.config import settings
    from app.services import password_reset, sms

    monkeypatch.setattr(settings, "sms_api_key", "test-only-not-a-real-key")
    monkeypatch.setattr(settings, "app_env", "production")

    monkeypatch.setattr(settings, "sms_provider", "kavenegar")
    assert sms.is_configured() is True
    assert password_reset.is_available() is True

    monkeypatch.setattr(settings, "sms_provider", "twilio")
    assert isinstance(sms.get_sender(), sms.NullSmsSender)
    # نکتهٔ تست: این دو باید **با هم** بچرخند. اگر `is_configured` آری بگوید
    # ولی `get_sender` خنثی بدهد، پرچمِ `/auth/config` دروغ می‌شود.
    assert sms.is_configured() is False
    assert password_reset.is_available() is False

    # خالی (یا فقط فاصله) همان پیش‌فرض است، نه «ناشناس».
    monkeypatch.setattr(settings, "sms_provider", "   ")
    assert sms.provider_name() == "kavenegar"
    assert sms.is_configured() is True


def test_error_text_never_carries_the_api_key() -> None:
    """`_scrub` کلید را از هر متنی که ممکن است لاگ شود پاک می‌کند.

    چرا مهم است: آدرسِ کاوه‌نگار کلید را **در مسیرِ URL** دارد و
    `httpx.HTTPStatusError` آدرسِ کامل را داخلِ پیامِ خودش می‌گذارد؛ پس
    فیلترهای `?key=…` این شکل را نمی‌گیرند.
    """
    from app.core.config import settings
    from app.services import sms

    original = settings.sms_api_key
    settings.sms_api_key = "test-only-not-a-real-key"
    try:
        noisy = f"POST https://api.kavenegar.com/v1/{settings.sms_api_key}/verify/lookup.json"
        cleaned = sms._scrub(noisy)
    finally:
        settings.sms_api_key = original

    assert "test-only-not-a-real-key" not in cleaned
    assert "***" in cleaned


def test_masked_phone_keeps_only_the_last_four_digits() -> None:
    """لاگ‌ها شمارهٔ کامل ندارند (§۵ — دادهٔ حساس در لاگ نه)."""
    from app.services import sms

    assert sms.mask_phone("09123456789") == "***6789"
    assert "0912345" not in sms.mask_phone("09123456789")


# ── دو راهِ دور‌زدنِ «پاسخِ یکسان» که ۲۰۲۶-۰۹-۲۸ بسته شد ───────────
def test_member_without_a_password_cannot_reset(
    client: Any, home_a: Actor, outbox: list[dict[str, str]]
) -> None:
    """عضوی که مدیر ساخته و خودش ثبت‌نام نکرده، رمزی ندارد تا «فراموش» کند.

    اگر مسیرِ بازیابی برایش رمز بنشاند، می‌شود راهِ دومِ *ثبت‌نام* — و راهِ
    بدی هم هست: `add_member_by_manager` سطر را با `status='pending'` می‌سازد
    ولی `membership_state` پیش‌فرضِ `'active'` دارد و `_ensure_can_login` تنها
    همین دومی را می‌سنجد. پس کاربر نشست می‌گرفت بی‌آنکه از `/auth/register`
    بگذرد؛ `status` تا ابد `pending` می‌ماند و `/auth/pre-registered` برای آن
    شماره همیشه `true` می‌گفت — یک اوراکلِ شمارشِ همیشه‌باز.

    رفتارِ درست: همان ۲۰۰ِ خالی (نباید فاش شود که این شماره شناخته است) ولی
    **هیچ کدی ساخته و فرستاده نشود**.
    """
    pending_phone = next_phone()
    added = client.post(
        f"{AUTH}/members",
        json={"name": "عضوِ نساخته", "phone": pending_phone, "relation": "فرزند"},
        headers=home_a.h,
    )
    assert added.status_code == 200, added.text

    res = _request_reset(client, pending_phone)
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True}
    assert outbox == [], "برای عضوِ بی‌رمز نباید کدی فرستاده شود"

    # و کدی هم در جدول ننشسته، پس گامِ ۲ راهِ ورود نمی‌دهد.
    blocked = _confirm_reset(client, pending_phone, "123456", _NEW_PASSWORD)
    assert blocked.status_code == 400
    assert blocked.json()["error"] == "INVALID_OTP"


def test_unknown_phone_still_pays_the_hash_cost(
    client: Any, home_a: Actor, monkeypatch: pytest.MonkeyPatch
) -> None:
    """شمارهٔ ناشناس هم هزینهٔ یک تأییدِ Argon2 را می‌سوزاند.

    چرا این تست در پروندهٔ بازیابیِ رمز است: بی‌این مهار، کلِ §۹.۵ دور‌زدنی
    بود. `check_password_gated` هش را فقط وقتی اجرا می‌کرد که عضو وجود داشته
    باشد و `password_hash` داشته باشد — یعنی روی اندپوینتِ بی‌احراز
    `/auth/check-password`، شمارهٔ ثبت‌شده صدها میلی‌ثانیه و شمارهٔ ثبت‌نشده
    حدودِ یک میلی‌ثانیه طول می‌کشید. مهاجم به‌جای مسیرِ بازیابی از آن‌جا
    می‌پرسید.

    زمان را نمی‌سنجیم (تستِ زمانی لق است)؛ *فراخوانی* را می‌سنجیم. توجه:
    `passwords.py` نام را با `from … import` می‌گیرد، پس باید همان نامِ
    درونِ ماژول جا‌به‌جا شود، نه `core.security`.
    """
    from app.services import passwords

    calls: list[int] = []
    monkeypatch.setattr(passwords, "burn_verify_cost", lambda: calls.append(1))

    unknown = client.post(
        f"{AUTH}/check-password", json={"phone": _UNKNOWN_PHONE, "password": PASSWORD}
    )
    assert unknown.status_code == 200, unknown.text
    assert unknown.json() == {"ok": False}
    assert len(calls) == 1, "مسیرِ شمارهٔ ناشناس باید هزینهٔ هش را بسوزاند"

    # مسیرِ واقعی خودش هش می‌زند، پس نباید دوباره بسوزاند.
    known = client.post(
        f"{AUTH}/check-password", json={"phone": home_a.phone, "password": PASSWORD}
    )
    assert known.status_code == 200, known.text
    assert known.json() == {"ok": True}
    assert len(calls) == 1, "مسیرِ عضوِ واقعی نباید هزینهٔ اضافه بدهد"
