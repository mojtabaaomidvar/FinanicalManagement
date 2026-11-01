"""§5.10 — ایزولهٔ خانواده: کاربر خانوادهٔ الف نباید به دادهٔ خانوادهٔ ب برسد.

این فایل «قلبِ» شبکهٔ ایمنیِ مرحلهٔ A است. هر تست دو چیز را با هم می‌سنجد:
  ۱. درخواست رد شود (کد ۴۰۱/۴۰۳/۴۰۴/۴۲۲).
  ۲. و مهم‌تر: دادهٔ خانوادهٔ ب دست‌نخورده بماند و در پاسخ‌های الف دیده نشود.

چرا هر دو؟ چون کدِ وضعیت به‌تنهایی گول‌زننده است: یک DELETE می‌تواند ۴۰۴ برگرداند
و ردیف را هم پاک کرده باشد. سنجشِ «بقای داده» چیزی است که واقعاً مرز را اثبات می‌کند.

دامنه: فقط سنجش رفتار امروز. هیچ اسکیمایی عوض نمی‌شود (مرحلهٔ A).
"""

from __future__ import annotations

from typing import Any

from tests.conftest import (
    API,
    AUTH,
    CATEGORY,
    Actor,
    make_account,
    make_category_budget,
    make_custom_category,
    make_event,
    make_holding,
    make_subcategory,
    make_transaction,
)

# «رد شدن» فقط یعنی درخواست کارساز نبود؛ شکلِ ردش (۴۰۴ یا ۴۰۳) قراردادِ محصول است
# نه مرزِ امنیت. ۲۰۰ و ۲۰۴ و ۲۰۱ هرگز نباید در این فایل دیده شوند.
DENIED = {400, 401, 403, 404, 409, 422}


def assert_denied(res: Any, what: str) -> None:
    assert res.status_code in DENIED, (
        f"نشتِ مرز خانواده در «{what}» — کد {res.status_code} برگشت: {res.text[:300]}"
    )


def ids(rows: list[dict]) -> set[str]:
    return {r["id"] for r in rows}


# ═══════════════════════════════════════════════════════════════════
#  خواندن — فهرست‌ها فقط دادهٔ خانوادهٔ خود را برگردانند
# ═══════════════════════════════════════════════════════════════════
def test_lists_never_show_the_other_household(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    a_acc, b_acc = make_account(client, home_a, "حساب الف"), make_account(client, home_b, "حساب ب")
    a_tx, b_tx = make_transaction(client, home_a), make_transaction(client, home_b)
    a_ev, b_ev = make_event(client, home_a), make_event(client, home_b)
    make_subcategory(client, home_a, "نانِ الف")
    b_sub = make_subcategory(client, home_b, "نانِ ب")

    accounts = client.get(f"{API}/accounts", headers=home_a.h)
    assert accounts.status_code == 200, accounts.text
    assert ids(accounts.json()) == {a_acc}, "حساب خانوادهٔ ب در فهرست الف دیده شد"

    txs = client.get(f"{API}/transactions", headers=home_a.h)
    assert txs.status_code == 200, txs.text
    assert ids(txs.json()) == {a_tx}
    assert b_tx not in ids(txs.json())

    events = client.get(f"{API}/events", headers=home_a.h)
    assert events.status_code == 200, events.text
    assert ids(events.json()) == {a_ev}
    assert b_ev not in ids(events.json())

    subs = client.get(f"{API}/subcategories", headers=home_a.h)
    assert subs.status_code == 200, subs.text
    assert b_sub not in ids(subs.json())

    # و برعکس — مرز باید دوطرفه باشد، نه فقط از الف به ب.
    b_accounts = client.get(f"{API}/accounts", headers=home_b.h)
    assert ids(b_accounts.json()) == {b_acc}


def test_members_and_family_are_scoped(client: Any, home_a: Actor, home_b: Actor) -> None:
    """GET /members و GET /family فقط خانوادهٔ خودِ توکن را بدهند (این‌ها زیر RLS نیستند)."""
    members = client.get(f"{AUTH}/members", headers=home_a.h)
    assert members.status_code == 200, members.text
    rows = members.json()
    assert {r["family_id"] for r in rows} == {home_a.family_id}
    assert home_b.member_id not in ids(rows)
    assert all(r["phone"] != home_b.phone for r in rows), "شمارهٔ عضو خانوادهٔ دیگر نشت کرد"

    fam = client.get(f"{AUTH}/family", headers=home_a.h)
    assert fam.status_code == 200, fam.text
    assert fam.json()["id"] == home_a.family_id

    payload = client.get(f"{AUTH}/session", headers=home_a.h)
    assert payload.status_code == 200, payload.text
    assert payload.json()["family"]["id"] == home_a.family_id


# ═══════════════════════════════════════════════════════════════════
#  نوشتن — دست‌بردن در منبعِ خانوادهٔ دیگر
# ═══════════════════════════════════════════════════════════════════
def test_cannot_touch_other_household_account(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    b_acc = make_account(client, home_b, "حساب ب")

    assert_denied(
        client.patch(f"{API}/accounts/{b_acc}", headers=home_a.h, json={"title": "دزدیده‌شده"}),
        "PATCH حساب خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{API}/accounts/{b_acc}", headers=home_a.h),
        "DELETE حساب خانوادهٔ دیگر",
    )

    survivors = client.get(f"{API}/accounts", headers=home_b.h).json()
    assert ids(survivors) == {b_acc}, "حساب خانوادهٔ ب حذف شد!"
    assert survivors[0]["title"] == "حساب ب", "عنوان حساب خانوادهٔ ب عوض شد!"


def test_cannot_touch_other_household_transaction(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    b_tx = make_transaction(client, home_b, "77000")
    edit = {
        "member_id": home_a.member_id,
        "type": "expense",
        "amount": "1",
        "category": CATEGORY,
        "date": "2026-09-02",
    }

    assert_denied(
        client.patch(f"{API}/transactions/{b_tx}", headers=home_a.h, json=edit),
        "PATCH تراکنش خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{API}/transactions/{b_tx}", headers=home_a.h),
        "DELETE تراکنش خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{API}/transactions/{b_tx}/occurrences",
            headers=home_a.h,
            json={"due_date": "2026-09-02"},
        ),
        "تأیید سررسیدِ تراکنش خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{API}/transactions/{b_tx}/photos",
            headers=home_a.h,
            json={"url": "https://example.test/x.jpg", "caption": "نفوذ"},
        ),
        "افزودن عکس به تراکنش خانوادهٔ دیگر",
    )

    rows = client.get(f"{API}/transactions", headers=home_b.h).json()
    assert ids(rows) == {b_tx}, "تراکنش خانوادهٔ ب حذف شد!"
    assert float(rows[0]["amount"]) == 77000.0, "مبلغ تراکنش خانوادهٔ ب عوض شد!"
    assert rows[0]["photos"] == [], "عکسِ بیگانه به تراکنش خانوادهٔ ب چسبید!"


def test_cannot_reference_other_household_rows_in_body(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """کلیدِ خارجیِ خانوادهٔ دیگر در بدنه — پستگرس FK را می‌پذیرد، پس لایهٔ اپ باید رد کند.

    این تستِ مهمی است: قیدِ FK مشمول RLS نیست. اگر سرویس شناسهٔ ورودی را با
    خانوادهٔ خودِ کاربر نسنجد، می‌شود تراکنشی ساخت که به حسابِ خانوادهٔ دیگر اشاره کند.
    """
    b_acc = make_account(client, home_b, "حساب ب")

    assert_denied(
        client.post(
            f"{API}/transactions",
            headers=home_a.h,
            json={
                "member_id": home_a.member_id,
                "type": "expense",
                "amount": "1000",
                "category": CATEGORY,
                "date": "2026-09-01",
                "account_id": b_acc,
            },
        ),
        "تراکنش با account_id خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{API}/transactions",
            headers=home_a.h,
            json={
                "member_id": home_b.member_id,
                "type": "expense",
                "amount": "1000",
                "category": CATEGORY,
                "date": "2026-09-01",
            },
        ),
        "تراکنش به نامِ عضوِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{API}/accounts",
            headers=home_a.h,
            json={"member_id": home_b.member_id, "title": "حساب جعلی", "kind": "bank"},
        ),
        "حساب به نامِ عضوِ خانوادهٔ دیگر",
    )

    assert client.get(f"{API}/transactions", headers=home_a.h).json() == []


def test_cannot_touch_other_household_categories_and_budgets(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    b_sub = make_subcategory(client, home_b, "نانِ ب")
    b_cc = make_custom_category(client, home_b, "باشگاهِ ب")
    make_category_budget(client, home_b, CATEGORY)

    assert_denied(
        client.delete(f"{API}/subcategories/{b_sub}", headers=home_a.h),
        "DELETE زیردستهٔ خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{API}/custom-categories/{b_cc}", headers=home_a.h),
        "DELETE دستهٔ سفارشیِ خانوادهٔ دیگر",
    )
    # سقف بودجه با «نام دسته» حذف می‌شود نه شناسه؛ پس تنها چیزی که مرز را اثبات
    # می‌کند بقای ردیفِ خانوادهٔ ب است — کدِ وضعیت اینجا معنای امنیتی ندارد.
    client.delete(f"{API}/category-budgets/{CATEGORY}", headers=home_a.h)

    assert ids(client.get(f"{API}/subcategories", headers=home_b.h).json()) == {b_sub}
    assert ids(client.get(f"{API}/custom-categories", headers=home_b.h).json()) == {b_cc}
    budgets = client.get(f"{API}/category-budgets", headers=home_b.h).json()
    assert [b["category"] for b in budgets] == [CATEGORY], "سقف بودجهٔ خانوادهٔ ب پاک شد!"


def test_cannot_touch_other_household_events_and_holdings(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    b_ev = make_event(client, home_b, "تولدِ ب")
    b_hold = make_holding(client, home_b)

    assert_denied(
        client.delete(f"{API}/events/{b_ev}", headers=home_a.h),
        "DELETE رویدادِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.patch(f"{API}/holdings/{b_hold}", headers=home_a.h, json={"quantity": "999"}),
        "PATCH داراییِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{API}/holdings/{b_hold}", headers=home_a.h),
        "DELETE داراییِ خانوادهٔ دیگر",
    )

    assert ids(client.get(f"{API}/events", headers=home_b.h).json()) == {b_ev}


def test_cannot_touch_other_household_sms(client: Any, home_a: Actor, home_b: Actor) -> None:
    b_acc = make_account(client, home_b, "حساب ب")
    added = client.post(
        f"{API}/sms",
        headers=home_b.h,
        json={
            "items": [
                {
                    "raw_text": "برداشت ۵۰,۰۰۰ تومان",
                    "bank": "ملت",
                    "type": "expense",
                    "amount": "50000",
                    "date": "2026-09-01",
                }
            ]
        },
    )
    assert added.status_code == 200, added.text
    b_sms = client.get(f"{API}/sms", headers=home_b.h).json()
    assert len(b_sms) == 1
    b_sms_id = b_sms[0]["id"]

    assert client.get(f"{API}/sms", headers=home_a.h).json() == [], "پیامک خانوادهٔ ب نشت کرد"
    # مقدار «recorded» عمداً معتبر است؛ اگر مقدار بی‌ربط می‌فرستادیم، ردشدن می‌توانست
    # از اعتبارسنجیِ ورودی بیاید نه از مرزِ خانواده — و تست الکی سبز می‌شد.
    assert_denied(
        client.patch(f"{API}/sms/{b_sms_id}", headers=home_a.h, json={"status": "recorded"}),
        "PATCH پیامک خانوادهٔ دیگر",
    )
    assert_denied(
        client.patch(
            f"{API}/sms/accounts/{b_acc}/enabled", headers=home_a.h, json={"enabled": True}
        ),
        "فعال‌کردن پیامکِ حسابِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{API}/sms/accounts/{b_acc}", headers=home_a.h),
        "ریست پیامکِ حسابِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{API}/sms/accounts/{b_acc}/senders", headers=home_a.h, json={"sender": "BANK"}
        ),
        "افزودن سرشماره به حسابِ خانوادهٔ دیگر",
    )

    still = client.get(f"{API}/sms", headers=home_b.h).json()
    assert len(still) == 1 and still[0]["id"] == b_sms_id
    b_account = client.get(f"{API}/accounts", headers=home_b.h).json()[0]
    assert b_account["sms_enabled"] is False, "رضایتِ پیامکِ حسابِ خانوادهٔ ب از بیرون روشن شد!"


def test_cannot_touch_other_household_members(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """جدول members زیر RLS نیست؛ مرزش کاملاً لایهٔ اپ است — پس تستش واجب‌تر است."""
    from tests.conftest import add_active_member

    b_member = add_active_member(client, home_b, "عضو ب")

    assert_denied(
        client.patch(
            f"{API}/members/{b_member.member_id}/relation",
            headers=home_a.h,
            json={"relation": "همسر"},
        ),
        "تغییر نسبتِ عضوِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{AUTH}/members/{b_member.member_id}", headers=home_a.h),
        "حذف عضوِ خانوادهٔ دیگر",
    )

    rows = client.get(f"{AUTH}/members", headers=home_b.h).json()
    assert b_member.member_id in ids(rows), "عضو خانوادهٔ ب حذف شد!"
    target = next(r for r in rows if r["id"] == b_member.member_id)
    assert target["relation"] == "فرزند", "نسبتِ عضو خانوادهٔ ب عوض شد!"


def test_family_settings_do_not_cross_households(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """سقف بودجهٔ خانوادهٔ الف نباید روی خانوادهٔ ب بنشیند (هویتِ خانواده از توکن می‌آید)."""
    before = client.get(f"{AUTH}/family", headers=home_b.h).json()["budget"]

    res = client.patch(f"{API}/family/settings", headers=home_a.h, json={"budget": "12345"})
    assert res.status_code == 204, res.text

    assert client.get(f"{AUTH}/family", headers=home_b.h).json()["budget"] == before
    assert float(client.get(f"{AUTH}/family", headers=home_a.h).json()["budget"]) == 12345.0
