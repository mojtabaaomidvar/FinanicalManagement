"""§5.10 — مرزِ نشست: هویت فقط از هدرِ Bearer می‌آید، و توکنِ باطل‌شده مرده است.

این فایل همان «تصمیم قفل‌شدهٔ» بالای `app/api/deps.py` را به تست تبدیل می‌کند:

    هویت عضو/خانواده «فقط» از توکن نشست در هدر Authorization استخراج می‌شود؛
    هرگز از بدنه یا کوئریِ کلاینت.

اگر روزی کسی برای «راحتیِ کلاینت» اجازه دهد `family_id` یا `member_id` از بدنه
خوانده شود، مرزِ چند-خانوادگی همان لحظه فرو می‌ریزد — و تست‌های این فایل باید
پیش از رسیدن آن کد به سرور، قرمز شوند.

دامنه: فقط سنجش رفتار امروز. هیچ اسکیمایی عوض نمی‌شود (مرحلهٔ A).
"""

from __future__ import annotations

from typing import Any

import pytest

from tests.conftest import (
    API,
    AUTH,
    CATEGORY,
    PASSWORD,
    Actor,
    expect_status,
    make_transaction,
)

UNAUTHORIZED = 401

# مسیرهایی که «باید» نشست بخواهند. عمداً از هر خانوادهٔ روتر یکی هست تا اگر روزی
# روتری بدون وابستگیِ احراز هویت سیم‌کشی شود، اینجا لو برود.
PROTECTED: list[tuple[str, str, dict | None]] = [
    ("GET", f"{AUTH}/session", None),
    ("GET", f"{AUTH}/family", None),
    ("GET", f"{AUTH}/members", None),
    ("POST", f"{AUTH}/invite", None),
    ("GET", f"{API}/transactions", None),
    ("GET", f"{API}/accounts", None),
    ("GET", f"{API}/subcategories", None),
    ("GET", f"{API}/custom-categories", None),
    ("GET", f"{API}/category-budgets", None),
    ("GET", f"{API}/events", None),
    ("GET", f"{API}/sms", None),
    ("GET", f"{API}/sms/senders", None),
    ("GET", f"{API}/sms/numbers", None),
    ("PATCH", f"{API}/family/settings", {"budget": "1"}),
    ("PATCH", f"{API}/members/me/theme", {"theme": "dark"}),
    ("POST", f"{API}/events", {"title": "بی‌نشست", "date": "2026-10-01"}),
]

# هدرهای بدشکل. نکتهٔ مهم: «Bearerxyz» بدونِ فاصله است، پس اصلاً اسکیم شناخته
# نمی‌شود؛ اگر روزی کسی به‌جای split از startswith استفاده کند، همین مورد می‌شکند.
BAD_HEADERS = [
    ("", "هدرِ خالی"),
    ("Bearer", "فقط کلمهٔ Bearer بدون توکن"),
    ("Bearer ", "Bearer با فاصلهٔ خالی"),
    ("Bearerxyz", "Bearer چسبیده به توکن"),
    ("Token abc", "اسکیمِ اشتباه"),
    ("Basic YWJjOjEyMw==", "اسکیمِ Basic"),
    ("abc", "توکنِ لخت بدون اسکیم"),
]


# ═══════════════════════════════════════════════════════════════════
#  ۱) بدونِ توکن، هیچ دری باز نمی‌شود
# ═══════════════════════════════════════════════════════════════════
@pytest.mark.parametrize(("method", "url", "body"), PROTECTED)
def test_no_token_is_rejected(client: Any, method: str, url: str, body: dict | None) -> None:
    res = client.request(method, url, json=body)
    assert res.status_code == UNAUTHORIZED, (
        f"«{method} {url}» بدونِ توکن {res.status_code} داد (باید ۴۰۱ باشد): {res.text[:200]}"
    )


@pytest.mark.parametrize(("header", "label"), BAD_HEADERS)
def test_malformed_authorization_header_is_rejected(
    client: Any, home_a: Actor, header: str, label: str
) -> None:
    res = client.get(f"{AUTH}/session", headers={"Authorization": header})
    assert res.status_code == UNAUTHORIZED, f"«{label}» پذیرفته شد: {res.text[:200]}"

    # شاهدِ مثبت: همان توکن با قالبِ درست کار می‌کند — پس ۴۰۱ از «قالب» آمده،
    # نه از خرابیِ کلیِ مسیر.
    assert client.get(f"{AUTH}/session", headers=home_a.h).status_code == 200


def test_bearer_scheme_is_case_insensitive(client: Any, home_a: Actor) -> None:
    """RFC 7235 اسکیم را حساس به بزرگی/کوچکی نمی‌داند؛ این رفتار عمدی است نه تصادفی."""
    res = client.get(f"{AUTH}/session", headers={"Authorization": f"bearer {home_a.token}"})
    assert res.status_code == 200, res.text


def test_unknown_token_is_rejected(client: Any, home_a: Actor) -> None:
    for fake in ("not-a-real-token", home_a.token + "x", home_a.token[:-1]):
        res = client.get(f"{AUTH}/session", headers={"Authorization": f"Bearer {fake}"})
        assert res.status_code == UNAUTHORIZED, f"توکنِ جعلی پذیرفته شد: {res.text[:200]}"


def test_token_of_one_household_never_unlocks_the_other(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """توکنِ الف با هدرِ درست معتبر است — ولی فقط برای خانوادهٔ خودش."""
    payload = client.get(f"{AUTH}/session", headers=home_a.h)
    assert payload.status_code == 200, payload.text
    assert payload.json()["family"]["id"] == home_a.family_id
    assert payload.json()["family"]["id"] != home_b.family_id


# ═══════════════════════════════════════════════════════════════════
#  ۲) خروج — توکنِ باطل‌شده باید مرده بماند
# ═══════════════════════════════════════════════════════════════════
def _login(client: Any, who: Actor) -> str:
    """نشستِ دومِ همان عضو (شبیه‌سازیِ «دستگاه دوم»)."""
    res = client.post(f"{AUTH}/login", json={"phone": who.phone, "password": PASSWORD})
    assert res.status_code == 200, res.text
    return res.json()["session_token"]


def test_logout_kills_only_this_token(client: Any, home_a: Actor) -> None:
    second = _login(client, home_a)
    assert client.get(f"{AUTH}/session", headers={"Authorization": f"Bearer {second}"}).status_code == 200

    assert client.post(f"{AUTH}/logout", headers=home_a.h).status_code == 200

    assert client.get(f"{AUTH}/session", headers=home_a.h).status_code == UNAUTHORIZED, (
        "توکن پس از خروج هنوز کار می‌کند"
    )
    # دستگاهِ دوم نباید بیرون انداخته شود — خروج «این نشست» است نه «همهٔ نشست‌ها».
    assert (
        client.get(f"{AUTH}/session", headers={"Authorization": f"Bearer {second}"}).status_code
        == 200
    )


def test_logout_all_kills_every_token(client: Any, home_a: Actor) -> None:
    second = _login(client, home_a)
    third = _login(client, home_a)

    assert client.post(f"{AUTH}/logout-all", headers=home_a.h).status_code == 200

    for token, label in ((home_a.token, "اول"), (second, "دوم"), (third, "سوم")):
        res = client.get(f"{AUTH}/session", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == UNAUTHORIZED, f"نشستِ {label} پس از خروجِ همگانی زنده ماند"


def test_logout_does_not_touch_other_members(client: Any, home_a: Actor, member_a: Actor) -> None:
    assert client.post(f"{AUTH}/logout-all", headers=member_a.h).status_code == 200

    assert client.get(f"{AUTH}/session", headers=member_a.h).status_code == UNAUTHORIZED
    assert client.get(f"{AUTH}/session", headers=home_a.h).status_code == 200, (
        "خروجِ همگانیِ یک عضو، عضو دیگر را هم بیرون انداخت"
    )


def test_data_routes_reject_a_logged_out_token(client: Any, home_a: Actor) -> None:
    """خروج فقط روی مسیرهای احراز هویت اثر نکند — مسیرهای داده هم باید ببندند."""
    make_transaction(client, home_a)
    assert client.post(f"{AUTH}/logout", headers=home_a.h).status_code == 200

    for method, url, body in (
        ("GET", f"{API}/transactions", None),
        ("GET", f"{API}/accounts", None),
        ("POST", f"{API}/events", {"title": "پس از خروج", "date": "2026-10-01"}),
    ):
        res = client.request(method, url, headers=home_a.h, json=body)
        assert res.status_code == UNAUTHORIZED, f"«{method} {url}» پس از خروج {res.status_code} داد"


# ═══════════════════════════════════════════════════════════════════
#  ۳) هویت از بدنه/کوئری خوانده نشود
# ═══════════════════════════════════════════════════════════════════
def test_family_id_in_body_is_ignored(client: Any, home_a: Actor, home_b: Actor) -> None:
    """`family_id` در بدنه نباید ردیف را به خانوادهٔ دیگر ببرد.

    امروز این فیلد اصلاً در اسکیما نیست و Pydantic بی‌صدا دورش می‌اندازد. تست
    عمداً همین را قفل می‌کند: اگر روزی کسی فیلد را به اسکیما اضافه کند تا کلاینت
    «خانواده را انتخاب کند»، این تست پیش از دیپلوی قرمز می‌شود.
    """
    res = client.post(
        f"{API}/transactions",
        headers=home_a.h,
        json={
            "member_id": home_a.member_id,
            "type": "expense",
            "amount": "2500",
            "category": CATEGORY,
            "date": "2026-09-03",
            "family_id": home_b.family_id,  # ← باید نادیده گرفته شود
        },
    )
    expect_status(res, 201)
    tx_id = res.json()["id"]

    assert tx_id in {t["id"] for t in client.get(f"{API}/transactions", headers=home_a.h).json()}
    assert client.get(f"{API}/transactions", headers=home_b.h).json() == [], (
        "تراکنش به خانوادهٔ ب رفت — هویت از بدنه خوانده شد!"
    )


def test_family_id_in_query_is_ignored(client: Any, home_a: Actor, home_b: Actor) -> None:
    a_tx = make_transaction(client, home_a)
    b_tx = make_transaction(client, home_b)

    for params in (
        {"family_id": home_b.family_id},
        {"member_id": home_b.member_id},
        {"token": "whatever"},
    ):
        rows = client.get(f"{API}/transactions", headers=home_a.h, params=params)
        assert rows.status_code == 200, rows.text
        got = {t["id"] for t in rows.json()}
        assert got == {a_tx}, f"کوئریِ {list(params)[0]} فهرست را عوض کرد: {got}"
        assert b_tx not in got


def test_session_token_in_body_does_not_authenticate(client: Any, home_a: Actor) -> None:
    """توکنِ درست، ولی در بدنه به‌جای هدر → همچنان ۴۰۱."""
    res = client.post(
        f"{API}/events",
        json={
            "title": "با توکن در بدنه",
            "date": "2026-10-02",
            "session_token": home_a.token,
            "token": home_a.token,
        },
    )
    assert res.status_code == UNAUTHORIZED, res.text
    assert client.get(f"{API}/events", headers=home_a.h).json() == []
