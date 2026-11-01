"""§۱.۹ — مرزِ مسیرهای قبض (`/bills/*`).

تمرکزِ این فایل روی چیزی است که قبض را از یک CRUDِ معمولی جدا می‌کند:
**«پرداخت شد» دو چیز را با هم عوض می‌کند** (حالتِ قبض + یک تراکنشِ هزینهٔ
تازه). هر جا این دو از هم جدا بیفتند، پولِ خانواده غلط شمرده می‌شود:

* دو بار پرداخت → دو تراکنش → خرجِ ماه دو برابر.
* پرداختِ نیمه‌کاره → تراکنشِ یتیم یا قبضِ طلبکارِ پرداخت‌شده.
* برگرداندنِ پرداخت بی‌حذفِ تراکنش → هزینه‌ای در گزارش که مرجعش گم شده.

پس بیشترِ assertها «حالت **و** تراکنش» را با هم می‌سنجند، نه فقط کدِ پاسخ
را. کدِ وضعیت به‌تنهایی گول‌زننده است: یک ۴۰۹ می‌تواند برگردد و تراکنش هم
ساخته شده باشد.

⚠️ هیچ‌کدام از این تست‌ها به شبکه وصل نمی‌شود و هیچ کلیدِ واقعی لازم ندارد.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import (
    API,
    Actor,
    add_active_member,
    expect_status,
    make_account,
)

BILLS = f"{API}/bills"

DENIED = {400, 401, 403, 404, 409, 422}


def assert_denied(res: Any, what: str) -> None:
    assert res.status_code in DENIED, (
        f"نشتِ مرز در «{what}» — کد {res.status_code} برگشت: {res.text[:300]}"
    )


def new_bill(
    client: Any,
    who: Actor,
    *,
    kind: str = "electricity",
    title: str = "برق خانه",
    amount: str = "480000",
    due: str = "2026-11-15",
    **extra: Any,
) -> dict:
    body = {
        "kind": kind,
        "title": title,
        "amount": amount,
        "due_date": due,
        **extra,
    }
    res = client.post(BILLS, headers=who.h, json=body)
    expect_status(res, 201)
    return res.json()


def bills_of(client: Any, who: Actor) -> list[dict]:
    res = client.get(BILLS, headers=who.h)
    assert res.status_code == 200, res.text
    return res.json()


def txs_of(client: Any, who: Actor) -> list[dict]:
    res = client.get(f"{API}/transactions", headers=who.h)
    assert res.status_code == 200, res.text
    return res.json()


# ═══════════════════════════════════════════════════════════════════
#  احراز هویت
# ═══════════════════════════════════════════════════════════════════
def test_bill_routes_require_auth(client: Any) -> None:
    assert_denied(client.get(BILLS), "GET بی‌توکن")
    assert_denied(client.post(BILLS, json={"title": "x"}), "POST بی‌توکن")
    fake = "00000000-0000-4000-8000-000000000000"
    assert_denied(client.patch(f"{BILLS}/{fake}", json={}), "PATCH بی‌توکن")
    assert_denied(client.delete(f"{BILLS}/{fake}"), "DELETE بی‌توکن")
    assert_denied(client.post(f"{BILLS}/{fake}/pay", json={}), "pay بی‌توکن")


# ═══════════════════════════════════════════════════════════════════
#  اعتبارسنجی — قبضِ بی‌معنی نباید ذخیره شود
# ═══════════════════════════════════════════════════════════════════
def test_invalid_bill_is_rejected(client: Any, home_a: Actor) -> None:
    base = {
        "kind": "electricity",
        "title": "برق",
        "amount": "1000",
        "due_date": "2026-11-15",
    }
    cases = {
        "نوعِ ناشناس": {**base, "kind": "spaceship"},
        "عنوانِ خالی": {**base, "title": "   "},
        "مبلغِ صفر": {**base, "amount": "0"},
        "مبلغِ منفی": {**base, "amount": "-5000"},
        "بی‌تاریخ": {k: v for k, v in base.items() if k != "due_date"},
    }
    for what, body in cases.items():
        res = client.post(BILLS, headers=home_a.h, json=body)
        assert res.status_code == 422, f"«{what}» پذیرفته شد: {res.text}"
    assert bills_of(client, home_a) == []


def test_bill_identifiers_must_be_digits(client: Any, home_a: Actor) -> None:
    """شناسهٔ قبض/پرداخت رشته می‌ماند (صفرِ ابتدایی دارد) ولی باید رقم باشد."""
    res = client.post(
        BILLS,
        headers=home_a.h,
        json={
            "kind": "water",
            "title": "آب",
            "amount": "100000",
            "due_date": "2026-11-15",
            "bill_no": "abc-123",
        },
    )
    assert res.status_code == 422, res.text


def test_leading_zero_in_identifier_survives(client: Any, home_a: Actor) -> None:
    """اگر شناسه به عدد تبدیل می‌شد، صفرِ ابتدایی می‌افتاد و قبض
    غیرقابلِ‌پرداخت می‌شد. این تست همان را قفل می‌کند."""
    row = new_bill(client, home_a, bill_no="0012345678901")
    assert row["bill_no"] == "0012345678901", row
    # ارقامِ فارسی هم نرمال می‌شوند، نه رد
    row2 = new_bill(client, home_a, title="گاز", bill_no="۰۰۹۸۷۶۵۴۳۲۱۰۱")
    assert row2["bill_no"] == "0098765432101", row2


# ═══════════════════════════════════════════════════════════════════
#  پرداخت — قلبِ این ماژول
# ═══════════════════════════════════════════════════════════════════
def test_pay_closes_bill_and_creates_one_expense(
    client: Any, home_a: Actor
) -> None:
    account = make_account(client, home_a, "کارت")
    bill = new_bill(client, home_a, amount="480000")
    assert bill["state"] == "unpaid"
    assert bill["transaction_id"] is None
    assert txs_of(client, home_a) == []

    res = client.post(
        f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={"account_id": account}
    )
    assert res.status_code == 200, res.text
    paid = res.json()

    assert paid["state"] == "paid"
    assert paid["paid_at"] is not None
    assert paid["paid_by_member_id"] == home_a.member_id
    assert paid["transaction_id"] is not None, (
        "قبضِ پرداخت‌شده باید به تراکنشش اشاره کند — وگرنه رابطهٔ §۴.۷ گم است"
    )

    txs = txs_of(client, home_a)
    assert len(txs) == 1, f"باید دقیقاً یک تراکنش ساخته شود: {txs}"
    tx = txs[0]
    assert tx["id"] == paid["transaction_id"]
    assert tx["type"] == "expense"
    assert tx["category"] == "bills", "پرداختِ قبض باید در دستهٔ «قبض» بنشیند"
    assert float(tx["amount"]) == 480000.0
    assert tx["account_id"] == account


def test_paying_twice_never_double_counts(client: Any, home_a: Actor) -> None:
    """خطرِ اصلیِ کلِ این طرح. دو لمسِ پشت‌سرهم نباید دو هزینه بسازد."""
    bill = new_bill(client, home_a)
    first = client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})
    assert first.status_code == 200, first.text

    second = client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})
    assert second.status_code == 409, second.text

    txs = txs_of(client, home_a)
    assert len(txs) == 1, f"پرداختِ دوباره تراکنشِ دوم ساخت — شمارشِ دوبل: {txs}"


def test_pay_without_account_is_allowed(client: Any, home_a: Actor) -> None:
    """پرداختِ نقدی: حساب اختیاری است (در تراکنش هم اختیاری است)."""
    bill = new_bill(client, home_a)
    res = client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})
    assert res.status_code == 200, res.text
    assert len(txs_of(client, home_a)) == 1


def test_pay_with_foreign_account_is_rejected_and_changes_nothing(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """حسابِ خانوادهٔ دیگر → رد. و مهم‌تر: قبض باید **پرداخت‌نشده** بماند.

    اگر حالتِ قبض پیش از اعتبارسنجیِ تراکنش عوض می‌شد، این‌جا قبضی داشتیم
    که «پرداخت‌شده» است ولی هیچ تراکنشی ندارد."""
    foreign = make_account(client, home_b, "کارتِ ب")
    bill = new_bill(client, home_a)

    res = client.post(
        f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={"account_id": foreign}
    )
    assert_denied(res, "پرداخت با حسابِ خانوادهٔ دیگر")

    after = bills_of(client, home_a)[0]
    assert after["state"] == "unpaid", "قبض با پرداختِ ناموفق بسته شد"
    assert after["transaction_id"] is None
    assert txs_of(client, home_a) == [], "تراکنشِ یتیم ساخته شد"


def test_unpay_removes_the_expense(client: Any, home_a: Actor) -> None:
    bill = new_bill(client, home_a)
    client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})
    assert len(txs_of(client, home_a)) == 1

    res = client.post(f"{BILLS}/{bill['id']}/unpay", headers=home_a.h)
    assert res.status_code == 200, res.text
    back = res.json()
    assert back["state"] == "unpaid"
    assert back["transaction_id"] is None
    assert back["paid_at"] is None
    assert txs_of(client, home_a) == [], (
        "برگرداندنِ پرداخت تراکنش را نبرد — هزینه‌ای بی‌مرجع در گزارش می‌ماند"
    )


def test_unpay_on_unpaid_bill_is_rejected(client: Any, home_a: Actor) -> None:
    bill = new_bill(client, home_a)
    res = client.post(f"{BILLS}/{bill['id']}/unpay", headers=home_a.h)
    assert res.status_code == 409, res.text


def test_only_payer_or_admin_can_undo(client: Any, home_a: Actor) -> None:
    """عضوِ دیگر نباید پرداختِ کسِ دیگری را برگرداند."""
    member = add_active_member(client, home_a, "عضو دوم")
    bill = new_bill(client, home_a)
    client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})

    denied = client.post(f"{BILLS}/{bill['id']}/unpay", headers=member.h)
    assert_denied(denied, "برگرداندنِ پرداختِ عضوِ دیگر")
    assert len(txs_of(client, member)) == 1, "تراکنش با تلاشِ ناموفق حذف شد"

    # مدیر می‌تواند
    ok = client.post(f"{BILLS}/{bill['id']}/unpay", headers=home_a.h)
    assert ok.status_code == 200, ok.text


# ═══════════════════════════════════════════════════════════════════
#  ویرایش / حذف / لغو
# ═══════════════════════════════════════════════════════════════════
def test_paid_bill_is_locked_for_edit_and_delete(
    client: Any, home_a: Actor
) -> None:
    """مبلغِ قبضِ پرداخت‌شده با تراکنشش هم‌خوان است؛ تغییرش آن را می‌شکست."""
    bill = new_bill(client, home_a, amount="100000")
    client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})

    edit = client.patch(
        f"{BILLS}/{bill['id']}",
        headers=home_a.h,
        json={
            "kind": "electricity",
            "title": "برق",
            "amount": "999999",
            "due_date": "2026-12-01",
        },
    )
    assert edit.status_code == 409, edit.text

    gone = client.delete(f"{BILLS}/{bill['id']}", headers=home_a.h)
    assert gone.status_code == 409, gone.text

    # و مبلغِ تراکنش دست‌نخورده مانده
    assert float(txs_of(client, home_a)[0]["amount"]) == 100000.0


def test_cancel_keeps_the_record_but_makes_no_expense(
    client: Any, home_a: Actor
) -> None:
    """لغو با حذف یکی نیست: سند می‌ماند، ولی پولی جابه‌جا نمی‌شود."""
    bill = new_bill(client, home_a)
    res = client.post(f"{BILLS}/{bill['id']}/cancel", headers=home_a.h)
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "cancelled"
    assert txs_of(client, home_a) == []
    assert len(bills_of(client, home_a)) == 1, "لغو نباید ردیف را حذف کند"

    # قبضِ لغوشده پرداخت نمی‌شود
    pay = client.post(f"{BILLS}/{bill['id']}/pay", headers=home_a.h, json={})
    assert pay.status_code == 409, pay.text


def test_unpaid_bill_can_be_edited_and_deleted(client: Any, home_a: Actor) -> None:
    bill = new_bill(client, home_a, amount="100000")
    edit = client.patch(
        f"{BILLS}/{bill['id']}",
        headers=home_a.h,
        json={
            "kind": "gas",
            "title": "گاز خانه",
            "amount": "250000",
            "due_date": "2026-12-01",
        },
    )
    assert edit.status_code == 200, edit.text
    assert edit.json()["kind"] == "gas"
    assert float(edit.json()["amount"]) == 250000.0

    gone = client.delete(f"{BILLS}/{bill['id']}", headers=home_a.h)
    assert gone.status_code == 204, gone.text
    assert bills_of(client, home_a) == []


# ═══════════════════════════════════════════════════════════════════
#  مرزِ خانواده (جدولِ زیرِ RLS)
# ═══════════════════════════════════════════════════════════════════
def test_bills_never_cross_households(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    a = new_bill(client, home_a, title="برقِ الف")
    b = new_bill(client, home_b, title="برقِ ب")

    assert {r["id"] for r in bills_of(client, home_a)} == {a["id"]}
    assert {r["id"] for r in bills_of(client, home_b)} == {b["id"]}

    # و هیچ کنشی روی قبضِ خانوادهٔ دیگر کار نمی‌کند
    assert_denied(
        client.patch(
            f"{BILLS}/{b['id']}",
            headers=home_a.h,
            json={
                "kind": "water",
                "title": "دست‌کاری",
                "amount": "1",
                "due_date": "2026-12-01",
            },
        ),
        "ویرایشِ قبضِ خانوادهٔ ب",
    )
    assert_denied(
        client.post(f"{BILLS}/{b['id']}/pay", headers=home_a.h, json={}),
        "پرداختِ قبضِ خانوادهٔ ب",
    )
    assert_denied(
        client.delete(f"{BILLS}/{b['id']}", headers=home_a.h),
        "حذفِ قبضِ خانوادهٔ ب",
    )

    # دادهٔ ب دست‌نخورده: همان یک قبضِ پرداخت‌نشده
    surviving = bills_of(client, home_b)
    assert len(surviving) == 1 and surviving[0]["state"] == "unpaid", surviving
    assert txs_of(client, home_b) == [], "تراکنشی در خانوادهٔ ب ساخته شد"


def test_member_can_manage_household_bills(client: Any, home_a: Actor) -> None:
    """قبض دادهٔ HOUSEHOLD_SHAREDِ §۵.۲ است — محدودِ مدیر نیست."""
    member = add_active_member(client, home_a, "عضو")
    row = new_bill(client, member, title="اینترنت", kind="internet")
    assert row["created_by"] == member.member_id

    # مدیر هم همان قبض را می‌بیند
    assert row["id"] in {r["id"] for r in bills_of(client, home_a)}

    paid = client.post(f"{BILLS}/{row['id']}/pay", headers=member.h, json={})
    assert paid.status_code == 200, paid.text


# ═══════════════════════════════════════════════════════════════════
#  ترتیب — یک مرجع برای همهٔ مصرف‌کننده‌ها
# ═══════════════════════════════════════════════════════════════════
def test_unpaid_come_first_ordered_by_due_date(client: Any, home_a: Actor) -> None:
    """ترتیب در سرور تعیین می‌شود تا صفحهٔ قبوض، کاشیِ هاب و اعلان یک
    فهرستِ یکسان ببینند."""
    late = new_bill(client, home_a, title="دیر", due="2026-12-20")
    soon = new_bill(client, home_a, title="زود", due="2026-11-01")
    done = new_bill(client, home_a, title="پرداخت‌شده", due="2026-10-01")
    client.post(f"{BILLS}/{done['id']}/pay", headers=home_a.h, json={})

    ids = [r["id"] for r in bills_of(client, home_a)]
    assert ids[0] == soon["id"], f"سررسیدِ نزدیک‌تر باید اول باشد: {ids}"
    assert ids[1] == late["id"]
    assert ids[2] == done["id"], "پرداخت‌شده باید آخر باشد"
