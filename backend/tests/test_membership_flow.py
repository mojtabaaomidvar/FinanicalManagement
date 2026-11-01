"""§۲.۳–۲.۶ مرحلهٔ B — جریانِ عضویت و اجازه‌دهیِ نقش (پیوستن/تأیید/رد + ارتقا/تنزل).

اینجا رفتارِ *تازهٔ* مرحلهٔ B قفل می‌شود (برخلافِ test_known_gaps که شکاف‌ها را ثبت
می‌کرد). سه محورِ آزموده‌شده:

  • جریانِ پیوستن (§2.6): لینک یا کدِ خانواده → درخواستِ pending (بی‌نشست) → تأیید/ردِ
    مدیر → گیتِ ورود (فقط عضوِ ACTIVE نشست می‌گیرد).
  • نقشِ مدیر (§2.3/§2.4): ارتقا به مدیرِ دوم، سقفِ «حداکثر دو مدیر»، و مصونیتِ
    «سازنده» (created_by) از تنزل.
  • مرزِ چند-مستأجری: درخواست‌های پیوستن زیرِ RLS خانواده‌اند؛ خانوادهٔ دیگر نه
    می‌بیندشان نه تصمیم می‌گیرد.

همهٔ نقش‌ها owner/member ماندند (بی‌ری‌مپ)؛ اجازه‌دهی یک‌جا از is_admin خوانده می‌شود،
پس owner و admin هر دو «مدیر»اند.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import (
    API,
    AUTH,
    PASSWORD,
    Actor,
    accept_invite,
    add_active_member,
    approve_join_request,
    create_invite_token,
    login_as,
    next_phone,
)


# ═══════════════════════════════════════════════════════════════════
#  ۱) پیوستن با کدِ خانواده → تأیید → ورود
# ═══════════════════════════════════════════════════════════════════
def test_join_by_code_waits_for_approval_then_logs_in(client: Any, home_a: Actor) -> None:
    """پیوستن با «کدِ ۶ رقمیِ خانواده» همان جریانِ pending→approve را دارد (بی‌نشست)."""
    phone = next_phone()
    res = client.post(
        f"{AUTH}/join",
        json={
            "code": home_a.family_code,
            "member_name": "کدی",
            "phone": phone,
            "password": PASSWORD,
            "relation": "فرزند",
        },
    )
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "pending", res.text

    # پیش از تأیید ورود ممنوع است.
    denied = client.post(f"{AUTH}/login", json={"phone": phone, "password": PASSWORD})
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"] == "MEMBERSHIP_PENDING", denied.text

    # درخواست در فهرستِ مدیر با via='code' دیده می‌شود.
    reqs = client.get(f"{AUTH}/join-requests", headers=home_a.h)
    assert reqs.status_code == 200, reqs.text
    row = next((r for r in reqs.json() if r["phone"] == phone), None)
    assert row is not None and row["via"] == "code", reqs.text

    # تأیید → ورود ممکن و دسترسی به داده باز.
    ok = client.post(f"{AUTH}/join-requests/{row['id']}/approve", headers=home_a.h)
    assert ok.status_code == 200, ok.text
    joiner = login_as(client, phone)
    assert client.get(f"{API}/transactions", headers=joiner.h).status_code == 200


def test_invalid_family_code_is_rejected(client: Any, home_a: Actor) -> None:
    """کدِ خانوادهٔ ناموجود → INVALID_CODE/۴۰۴ (نه ۵۰۰، نه نشتِ وجود/عدمِ خانواده)."""
    res = client.post(
        f"{AUTH}/join",
        json={
            "code": "000000",
            "member_name": "کدی",
            "phone": next_phone(),
            "password": PASSWORD,
            "relation": "فرزند",
        },
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"] == "INVALID_CODE", res.text


# ═══════════════════════════════════════════════════════════════════
#  ۲) ردِ درخواست → ورود همچنان بسته
# ═══════════════════════════════════════════════════════════════════
def test_rejected_join_request_blocks_login(client: Any, home_a: Actor) -> None:
    """پس از ردِ مدیر، عضویت 'rejected' می‌شود و ورود با پیامِ صریح مسدود می‌ماند."""
    token = create_invite_token(client, home_a)
    phone = next_phone()
    assert accept_invite(client, token, name="ردی", phone=phone).status_code == 200

    reqs = client.get(f"{AUTH}/join-requests", headers=home_a.h).json()
    rid = next(r["id"] for r in reqs if r["phone"] == phone)
    assert client.post(f"{AUTH}/join-requests/{rid}/reject", headers=home_a.h).status_code == 200

    denied = client.post(f"{AUTH}/login", json={"phone": phone, "password": PASSWORD})
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"] == "MEMBERSHIP_REJECTED", denied.text

    # درخواستِ رد‌شده دیگر در فهرستِ در‌انتظار نیست.
    again = client.get(f"{AUTH}/join-requests", headers=home_a.h).json()
    assert all(r["phone"] != phone for r in again)


def test_deciding_twice_conflicts(client: Any, home_a: Actor) -> None:
    """تصمیمِ دوباره روی همان درخواست → ALREADY_DECIDED/۴۰۹ (idempotency مرزی)."""
    token = create_invite_token(client, home_a)
    phone = next_phone()
    accept_invite(client, token, name="دوباره", phone=phone)
    reqs = client.get(f"{AUTH}/join-requests", headers=home_a.h).json()
    rid = next(r["id"] for r in reqs if r["phone"] == phone)

    assert client.post(f"{AUTH}/join-requests/{rid}/approve", headers=home_a.h).status_code == 200
    second = client.post(f"{AUTH}/join-requests/{rid}/reject", headers=home_a.h)
    assert second.status_code == 409, second.text
    assert second.json()["error"] == "ALREADY_DECIDED", second.text


# ═══════════════════════════════════════════════════════════════════
#  ۳) ارتقا/تنزلِ مدیر (§2.3/§2.4)
# ═══════════════════════════════════════════════════════════════════
def test_promote_then_demote_second_admin(client: Any, home_a: Actor) -> None:
    """مدیر یک عضوِ فعال را به مدیرِ دوم ارتقا و سپس تنزل می‌دهد."""
    m = add_active_member(client, home_a, "عضو")

    up = client.post(f"{AUTH}/members/{m.member_id}/promote", headers=home_a.h)
    assert up.status_code == 200, up.text
    assert up.json()["role"] == "admin"

    down = client.post(f"{AUTH}/members/{m.member_id}/demote", headers=home_a.h)
    assert down.status_code == 200, down.text
    assert down.json()["role"] == "member"


def test_admin_count_is_capped_at_two(client: Any, home_a: Actor) -> None:
    """سقفِ §2.3: owner + یک مدیرِ ارتقا‌یافته = ۲؛ ارتقای سومی → TOO_MANY_ADMINS."""
    m1 = add_active_member(client, home_a, "الف")
    m2 = add_active_member(client, home_a, "ب")

    assert client.post(f"{AUTH}/members/{m1.member_id}/promote", headers=home_a.h).status_code == 200
    third = client.post(f"{AUTH}/members/{m2.member_id}/promote", headers=home_a.h)
    assert third.status_code == 409, third.text
    assert third.json()["error"] == "TOO_MANY_ADMINS", third.text


def test_creator_cannot_be_demoted(client: Any, home_a: Actor) -> None:
    """سازندهٔ خانواده (created_by) غیرقابلِ تنزل است — حتی به دستِ خودش."""
    res = client.post(f"{AUTH}/members/{home_a.member_id}/demote", headers=home_a.h)
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "CANNOT_DEMOTE_CREATOR", res.text


def test_pending_member_cannot_be_promoted(client: Any, home_a: Actor) -> None:
    """فقط عضوِ ACTIVE می‌تواند مدیر شود؛ عضوِ pending → MEMBER_NOT_ACTIVE/۴۰۹."""
    token = create_invite_token(client, home_a)
    phone = next_phone()
    accept_invite(client, token, name="منتظر", phone=phone)
    reqs = client.get(f"{AUTH}/join-requests", headers=home_a.h).json()
    pending_member_id = next(r["member_id"] for r in reqs if r["phone"] == phone)

    res = client.post(f"{AUTH}/members/{pending_member_id}/promote", headers=home_a.h)
    assert res.status_code == 409, res.text
    assert res.json()["error"] == "MEMBER_NOT_ACTIVE", res.text


def test_promote_and_demote_are_idempotent(client: Any, home_a: Actor) -> None:
    """ارتقای عضوِ از‌قبل‌مدیر و تنزلِ عضوِ از‌قبل‌عادی هر دو ۲۰۰ و بی‌اثرِ اضافه‌اند."""
    m = add_active_member(client, home_a, "الف")

    a = client.post(f"{AUTH}/members/{m.member_id}/promote", headers=home_a.h)
    b = client.post(f"{AUTH}/members/{m.member_id}/promote", headers=home_a.h)
    assert a.status_code == b.status_code == 200, (a.text, b.text)
    assert b.json()["role"] == "admin"

    c = client.post(f"{AUTH}/members/{m.member_id}/demote", headers=home_a.h)
    d = client.post(f"{AUTH}/members/{m.member_id}/demote", headers=home_a.h)
    assert c.status_code == d.status_code == 200, (c.text, d.text)
    assert d.json()["role"] == "member"


def test_non_admin_cannot_promote_or_demote(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """عضوِ عادی به ارتقا/تنزل دسترسی ندارد (گیتِ require_admin روی خودِ روت)."""
    other = add_active_member(client, home_a, "دیگری")

    up = client.post(f"{AUTH}/members/{other.member_id}/promote", headers=member_a.h)
    assert up.status_code == 403, up.text
    assert up.json()["error"] == "FORBIDDEN", up.text

    down = client.post(f"{AUTH}/members/{other.member_id}/demote", headers=member_a.h)
    assert down.status_code == 403, down.text


def test_second_admin_can_approve_join_requests(client: Any, home_a: Actor) -> None:
    """مدیرِ دومِ ارتقا‌یافته (role='admin') هم می‌تواند درخواستِ پیوستن را تأیید کند.

    این اثباتِ مرکزی‌سازیِ اجازه‌دهی است: require_admin_tenant نقشِ 'admin' را هم
    مدیر می‌شناسد، نه فقط 'owner'.
    """
    admin2 = add_active_member(client, home_a, "مدیرِ دوم")
    assert (
        client.post(f"{AUTH}/members/{admin2.member_id}/promote", headers=home_a.h).status_code
        == 200
    )

    # یک متقاضیِ تازه که مدیرِ دوم باید تأییدش کند.
    token = create_invite_token(client, home_a)
    phone = next_phone()
    accept_invite(client, token, name="متقاضی", phone=phone)

    approved = approve_join_request(client, admin2, phone)  # با هدرِ مدیرِ دوم
    assert approved["role"] == "member", approved  # تأیید، عضوِ عادیِ فعال می‌سازد
    assert login_as(client, phone).token  # ورود پس از تأییدِ مدیرِ دوم کار می‌کند (عضویت ACTIVE شد)


# ═══════════════════════════════════════════════════════════════════
#  ۴) مرزِ چند-مستأجری روی درخواست‌های پیوستن
# ═══════════════════════════════════════════════════════════════════
def test_join_requests_are_family_isolated(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """درخواستِ پیوستنِ خانوادهٔ الف نه برای خانوادهٔ ب دیده می‌شود نه تصمیم‌پذیر است."""
    token = create_invite_token(client, home_a)
    phone = next_phone()
    accept_invite(client, token, name="الفی", phone=phone)

    reqs_a = client.get(f"{AUTH}/join-requests", headers=home_a.h).json()
    rid = next(r["id"] for r in reqs_a if r["phone"] == phone)

    # ب هیچ درخواستی از الف نمی‌بیند (زیرِ RLS خانواده).
    reqs_b = client.get(f"{AUTH}/join-requests", headers=home_b.h)
    assert reqs_b.status_code == 200, reqs_b.text
    assert all(r["phone"] != phone for r in reqs_b.json())

    # ب نمی‌تواند درخواستِ الف را تأیید کند (ردیف زیرِ RLS نامرئی → NOT_FOUND).
    stolen = client.post(f"{AUTH}/join-requests/{rid}/approve", headers=home_b.h)
    assert stolen.status_code == 404, stolen.text


def test_only_admin_lists_join_requests(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """عضوِ عادی به فهرستِ درخواست‌های پیوستن دسترسی ندارد (require_admin_tenant)."""
    res = client.get(f"{AUTH}/join-requests", headers=member_a.h)
    assert res.status_code == 403, res.text
    assert res.json()["error"] == "FORBIDDEN", res.text
