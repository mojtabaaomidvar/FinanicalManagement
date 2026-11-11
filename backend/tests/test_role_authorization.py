"""§5.10 — نقش: عضو عادی نباید کارِ مدیر را بکند، و مدیر نباید به دادهٔ خصوصیِ عضو برسد.

سه چیز با هم سنجیده می‌شود:
  ۱. عملیاتِ «فقط مدیر» برای عضو عادی ۴۰۳ شود.
  ۲. عضو عادی فقط ردیفِ خودش را دست بزند، نه ردیفِ مدیر (۴۰۴، چون کوئری اصلاً
     ردیفِ دیگری را نمی‌بیند — مرز در خودِ SELECT است، نه در یک if بعد از آن).
  ۳. Rule 16 — مدیر به دادهٔ «شخصیِ خصوصی» دسترسی خودکار ندارد.

هر بخش یک «شاهدِ مثبت» دارد: همان کار با هدرِ درست باید موفق شود. بدون شاهدِ مثبت،
یک اپِ کاملاً خراب هم همهٔ تست‌های رد را سبز می‌کند.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from tests.conftest import (
    API,
    AUTH,
    CATEGORY,
    Actor,
    add_active_member,
    expect_status,
    login_as,
    make_account,
    make_event,
    make_holding,
    make_transaction,
    next_card,
)

FORBIDDEN = 403
NOT_FOUND = 404


def _transaction_row(client: Any, who: Actor, tx_id: str) -> dict[str, Any]:
    response = client.get(f"{API}/transactions", headers=who.h)
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row["id"] == tx_id)


@pytest.fixture(params=("owner", "admin"))
def transaction_manager(request: Any, client: Any, home_a: Actor) -> Actor:
    """مدیر واقعی با نشست معتبر؛ فقط دادهٔ خانوادهٔ ایزولهٔ تست تغییر می‌کند."""
    if request.param == "owner":
        return home_a
    promoted = add_active_member(client, home_a, "مدیر دومِ تراکنش")
    response = client.post(
        f"{AUTH}/members/{promoted.member_id}/promote", headers=home_a.h
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "admin"
    admin = login_as(client, promoted.phone)
    assert admin.role == "admin"
    return admin


# ═══════════════════════════════════════════════════════════════════
#  ۱) عملیاتِ فقط-مدیر
# ═══════════════════════════════════════════════════════════════════
def test_member_cannot_run_owner_only_operations(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    owner_tx = make_transaction(client, home_a)

    denied = [
        ("PATCH", f"{API}/family/settings", {"budget": "999"}, "سقف بودجهٔ خانواده"),
        ("POST", f"{AUTH}/members", {"name": "نفوذی", "phone": "09129999999"}, "افزودن عضو"),
        ("POST", f"{AUTH}/invite", None, "ساخت لینک دعوت"),
        ("POST", f"{API}/category-budgets", {"category": CATEGORY, "amount": "1"}, "سقف دسته"),
        ("DELETE", f"{API}/category-budgets/{CATEGORY}", None, "حذف سقف دسته"),
        (
            "POST",
            f"{API}/transactions/{owner_tx}/occurrences",
            {"due_date": "2026-09-01"},
            "تأیید سررسید",
        ),
        ("DELETE", f"{AUTH}/members/{home_a.member_id}", None, "حذف عضو"),
    ]

    for method, url, body, label in denied:
        res = client.request(method, url, headers=member_a.h, json=body)
        assert res.status_code == FORBIDDEN, (
            f"«{label}» باید فقط برای مدیر باشد ولی برای عضو عادی {res.status_code} داد: "
            f"{res.text[:200]}"
        )

    # شاهدِ مثبت — همین مسیرها با هدرِ مدیر واقعاً کار می‌کنند.
    assert client.patch(f"{API}/family/settings", headers=home_a.h, json={"budget": "999"}).status_code == 204
    assert client.post(f"{AUTH}/invite", headers=home_a.h).status_code == 200
    assert client.post(
        f"{API}/category-budgets", headers=home_a.h, json={"category": CATEGORY, "amount": "1"}
    ).status_code == 200


def test_owner_cannot_be_removed_even_by_owner(client: Any, home_a: Actor) -> None:
    """مدیر نباید بتواند خودش را حذف کند — وگرنه خانواده بی‌مدیر می‌ماند."""
    res = client.delete(f"{AUTH}/members/{home_a.member_id}", headers=home_a.h)
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "CANNOT_REMOVE_OWNER"


# ═══════════════════════════════════════════════════════════════════
#  ۲) عضو عادی روی ردیفِ مدیر
# ═══════════════════════════════════════════════════════════════════
def test_member_cannot_reach_owner_rows(client: Any, home_a: Actor, member_a: Actor) -> None:
    owner_acc = make_account(client, home_a, "کارتِ مدیر")
    owner_tx = make_transaction(client, home_a)
    owner_ev = make_event(client, home_a, "رویدادِ مدیر")
    owner_hold = make_holding(client, home_a)

    cases = [
        ("DELETE", f"{API}/accounts/{owner_acc}", None, "حذف کارتِ مدیر"),
        ("PATCH", f"{API}/accounts/{owner_acc}", {"title": "مالِ من"}, "ویرایش کارتِ مدیر"),
        ("DELETE", f"{API}/transactions/{owner_tx}", None, "حذف تراکنشِ مدیر"),
        ("DELETE", f"{API}/events/{owner_ev}", None, "حذف رویدادِ مدیر"),
        ("PATCH", f"{API}/holdings/{owner_hold}", {"quantity": "999"}, "ویرایش داراییِ مدیر"),
        (
            "PATCH",
            f"{API}/sms/accounts/{owner_acc}/enabled",
            {"enabled": True},
            "روشن‌کردن پیامکِ کارتِ مدیر",
        ),
    ]
    for method, url, body, label in cases:
        res = client.request(method, url, headers=member_a.h, json=body)
        assert res.status_code == NOT_FOUND, (
            f"«{label}» باید برای عضو عادی ناموجود باشد ولی {res.status_code} داد: {res.text[:200]}"
        )

    # ردیف‌های مدیر سالم مانده‌اند.
    accounts = client.get(f"{API}/accounts", headers=home_a.h).json()
    owner_row = next(a for a in accounts if a["id"] == owner_acc)
    assert owner_row["title"] == "کارتِ مدیر"
    assert owner_row["sms_enabled"] is False
    assert owner_tx in {t["id"] for t in client.get(f"{API}/transactions", headers=home_a.h).json()}
    assert owner_ev in {e["id"] for e in client.get(f"{API}/events", headers=home_a.h).json()}


def test_member_can_manage_its_own_rows(client: Any, home_a: Actor, member_a: Actor) -> None:
    """شاهدِ مثبت — مرز «مالکیت» است، نه «قفلِ همه‌چیز»."""
    own_acc = make_account(client, member_a, "کارتِ خودم")
    own_tx = make_transaction(client, member_a)

    assert client.patch(
        f"{API}/accounts/{own_acc}",
        headers=member_a.h,
        json={"title": "کارتِ تازه", "card_number": next_card()},
    ).status_code == 200
    assert client.delete(f"{API}/transactions/{own_tx}", headers=member_a.h).status_code == 204
    assert client.delete(f"{API}/accounts/{own_acc}", headers=member_a.h).status_code == 204


def test_owner_can_reach_every_row_of_the_household(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """مدیر روی دادهٔ «مشترکِ خانواده» دستِ بازی دارد — این خواستهٔ فعلیِ محصول است."""
    member_acc = make_account(client, member_a, "کارتِ عضو")
    member_tx = make_transaction(client, member_a)

    assert client.patch(
        f"{API}/accounts/{member_acc}",
        headers=home_a.h,
        json={"title": "اصلاحِ مدیر", "card_number": next_card()},
    ).status_code == 200
    assert client.delete(f"{API}/transactions/{member_tx}", headers=home_a.h).status_code == 204


def test_member_cannot_edit_peer_transaction(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """عضو عادی حتی با نسبت‌دادن PATCH به خودش، تراکنشِ عضو دیگر را نمی‌گیرد."""
    peer = add_active_member(client, home_a, "عضو دیگرِ تراکنش")
    peer_tx = make_transaction(client, peer, "40000")
    original = _transaction_row(client, home_a, peer_tx)

    response = client.patch(
        f"{API}/transactions/{peer_tx}",
        headers=member_a.h,
        json={
            "member_id": member_a.member_id,
            "type": "expense",
            "amount": "1",
            "category": CATEGORY,
            "date": "2026-09-02",
            "note": "تغییرِ غیرمجاز",
        },
    )
    assert response.status_code == NOT_FOUND, response.text
    assert response.json()["error"] == "NOT_FOUND", response.text
    assert _transaction_row(client, home_a, peer_tx) == original


@pytest.mark.parametrize("recipient_role", ("owner", "member"))
def test_member_cannot_reassign_own_transaction(
    client: Any, home_a: Actor, member_a: Actor, recipient_role: str
) -> None:
    """عضو تراکنشِ خودش را هم نمی‌تواند به مدیر یا عضو دیگری نسبت دهد."""
    recipient = (
        home_a
        if recipient_role == "owner"
        else add_active_member(client, home_a, "عضو مقصدِ تراکنش")
    )
    own_tx = make_transaction(client, member_a, "30000")
    original = _transaction_row(client, home_a, own_tx)

    response = client.patch(
        f"{API}/transactions/{own_tx}",
        headers=member_a.h,
        json={
            "member_id": recipient.member_id,
            "type": "expense",
            "amount": "1",
            "category": CATEGORY,
            "date": "2026-09-02",
            "note": "نسبت‌دادنِ غیرمجاز",
        },
    )
    assert response.status_code == FORBIDDEN, response.text
    assert response.json()["error"] == "FORBIDDEN", response.text
    assert _transaction_row(client, home_a, own_tx) == original


def test_household_manager_can_edit_and_reassign_member_transaction(
    client: Any, home_a: Actor, member_a: Actor, transaction_manager: Actor
) -> None:
    """owner و admin هم مبلغ را اصلاح می‌کنند و هم عضو منتسب را داخل خانواده."""
    member_tx = make_transaction(client, member_a, "30000")
    body = {
        "member_id": member_a.member_id,
        "type": "expense",
        "amount": "25000",
        "category": CATEGORY,
        "date": "2026-09-02",
        "note": "اصلاحِ مدیر",
    }
    edited = client.patch(
        f"{API}/transactions/{member_tx}", headers=transaction_manager.h, json=body
    )
    assert edited.status_code == 204, edited.text
    updated = _transaction_row(client, home_a, member_tx)
    assert updated["member_id"] == member_a.member_id
    assert updated["family_id"] == home_a.family_id
    assert Decimal(str(updated["amount"])) == Decimal("25000")
    assert updated["date"] == body["date"]
    assert updated["note"] == body["note"]

    recipient = add_active_member(client, home_a, "عضو مقصدِ اصلاح مدیر")
    body = {**body, "member_id": recipient.member_id, "amount": "27000"}
    reassigned = client.patch(
        f"{API}/transactions/{member_tx}", headers=transaction_manager.h, json=body
    )
    assert reassigned.status_code == 204, reassigned.text
    updated = _transaction_row(client, home_a, member_tx)
    assert updated["member_id"] == recipient.member_id
    assert updated["family_id"] == home_a.family_id
    assert Decimal(str(updated["amount"])) == Decimal("27000")
    assert updated["date"] == body["date"]
    assert updated["note"] == body["note"]


def test_household_manager_cannot_edit_another_households_transaction(
    client: Any, home_a: Actor, home_b: Actor, transaction_manager: Actor
) -> None:
    """اجازهٔ owner/admin به خانوادهٔ خودش محدود می‌ماند و ردیفِ بیرونی سالم است."""
    foreign_tx = make_transaction(client, home_b, "40000")
    original = _transaction_row(client, home_b, foreign_tx)

    response = client.patch(
        f"{API}/transactions/{foreign_tx}",
        headers=transaction_manager.h,
        json={
            "member_id": home_b.member_id,
            "type": "expense",
            "amount": "1",
            "category": CATEGORY,
            "date": "2026-09-02",
            "note": "تغییرِ خانوادهٔ دیگر",
        },
    )
    assert response.status_code == NOT_FOUND, response.text
    assert response.json()["error"] == "NOT_FOUND", response.text
    assert _transaction_row(client, home_b, foreign_tx) == original


# ═══════════════════════════════════════════════════════════════════
#  ۳) Rule 16 — مدیر روی دادهٔ شخصیِ خصوصی
# ═══════════════════════════════════════════════════════════════════
def test_admin_does_not_override_private_personal_data(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """«شماره‌های مجازِ پیامک» دادهٔ شخصیِ عضو است و به عضو گره خورده، نه به خانواده.

    این تنها جای امروزِ محصول است که Rule 16 واقعاً پیاده شده؛ پس قفلش می‌کنیم تا
    یک بازنویسیِ بعدی بی‌سروصدا آن را به «خانواده‌محور» برنگرداند.
    """
    created = client.post(
        f"{API}/sms/numbers", headers=member_a.h, json={"phone": "09121234567", "label": "همراهِ دوم"}
    )
    expect_status(created, 201)
    number_id = created.json()["id"]

    assert client.get(f"{API}/sms/numbers", headers=home_a.h).json() == [], (
        "مدیر شمارهٔ شخصیِ عضو را دید — Rule 16 شکست"
    )
    assert client.delete(f"{API}/sms/numbers/{number_id}", headers=home_a.h).status_code == NOT_FOUND
    assert (
        client.patch(
            f"{API}/sms/numbers/{number_id}", headers=home_a.h, json={"active": False}
        ).status_code
        == NOT_FOUND
    )

    mine = client.get(f"{API}/sms/numbers", headers=member_a.h).json()
    assert [n["id"] for n in mine] == [number_id]
    assert mine[0]["active"] is True, "وضعیتِ شمارهٔ شخصیِ عضو از بیرون عوض شد"


def test_member_cannot_act_on_behalf_of_another_member(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    other = add_active_member(client, home_a, "عضو دوم")

    assert (
        client.post(
            f"{API}/events",
            headers=member_a.h,
            json={"title": "کارِ تو", "date": "2026-11-01", "member_id": other.member_id},
        ).status_code
        == FORBIDDEN
    ), "عضو عادی توانست رویداد را به نام عضو دیگری ثبت کند"

    assert (
        client.patch(
            f"{API}/members/{other.member_id}/relation",
            headers=member_a.h,
            json={"relation": "همسر"},
        ).status_code
        == FORBIDDEN
    )

    # شاهدِ مثبت: نسبتِ خودش را می‌تواند عوض کند، و مدیر نسبتِ دیگران را.
    assert (
        client.patch(
            f"{API}/members/{member_a.member_id}/relation",
            headers=member_a.h,
            json={"relation": "فرزند"},
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"{API}/members/{other.member_id}/relation", headers=home_a.h, json={"relation": "همسر"}
        ).status_code
        == 200
    )


def test_owner_relation_is_immutable(client: Any, home_a: Actor) -> None:
    res = client.patch(
        f"{API}/members/{home_a.member_id}/relation", headers=home_a.h, json={"relation": "فرزند"}
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "OWNER_RELATION_FIXED"
