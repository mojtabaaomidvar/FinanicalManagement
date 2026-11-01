"""§۱.۸ — مرزِ مسیرهای خرید و انبار (`/shopping/*` و `/inventory/*`).

تمرکزِ این فایل روی چیزی است که این ماژول را از یک CRUDِ معمولی جدا
می‌کند: **«خرید انجام شد» سه چیز را با هم عوض می‌کند** — اقلامِ لیست، یک
تراکنشِ هزینهٔ تازه، و موجودیِ انبار. هر جا این سه از هم جدا بیفتند،
یا پولِ خانواده غلط شمرده می‌شود یا انبار دروغ می‌گوید:

* دو بار بستنِ سفر → دو تراکنش → خرجِ ماه دو برابر.
* سفرِ نیمه‌کاره → تراکنشِ یتیم، یا انباری که پر شده ولی خریدش ثبت نشده.
* ۴۰۹ـی که تراکنش را هم ساخته باشد → هزینه‌ای بی‌مرجع در گزارش.

پس بیشترِ assertها «حالتِ قلم **و** تراکنش **و** انبار» را با هم می‌سنجند،
نه فقط کدِ پاسخ را. کدِ وضعیت به‌تنهایی گول‌زننده است (همان درسی که
test_bills.py ثبت کرده).

⚠️ هیچ‌کدام از این تست‌ها به شبکه وصل نمی‌شود و هیچ کلیدِ واقعی لازم ندارد.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from tests.conftest import (
    API,
    Actor,
    add_active_member,
    expect_status,
    make_account,
)

LISTS = f"{API}/shopping/lists"
ITEMS = f"{API}/shopping/items"
STOCK = f"{API}/inventory"

DENIED = {400, 401, 403, 404, 409, 422}
FAKE = "00000000-0000-4000-8000-000000000000"


def assert_denied(res: Any, what: str) -> None:
    assert res.status_code in DENIED, (
        f"نشتِ مرز در «{what}» — کد {res.status_code} برگشت: {res.text[:300]}"
    )


# ── سازنده‌های کوتاه ─────────────────────────────────────────
def new_list(client: Any, who: Actor, title: str = "سوپرمارکت") -> dict:
    res = client.post(LISTS, headers=who.h, json={"title": title})
    expect_status(res, 201)
    return res.json()


def new_item(
    client: Any,
    who: Actor,
    list_id: str,
    *,
    title: str = "نان",
    **extra: Any,
) -> dict:
    res = client.post(
        f"{LISTS}/{list_id}/items",
        headers=who.h,
        json={"title": title, **extra},
    )
    expect_status(res, 201)
    return res.json()


def new_stock(
    client: Any,
    who: Actor,
    *,
    title: str = "برنج",
    quantity: str = "1",
    threshold: str = "2",
    **extra: Any,
) -> dict:
    res = client.post(
        STOCK,
        headers=who.h,
        json={
            "title": title,
            "quantity": quantity,
            "threshold": threshold,
            **extra,
        },
    )
    expect_status(res, 201)
    return res.json()


def check(client: Any, who: Actor, item_id: str, on: bool = True) -> Any:
    return client.post(
        f"{ITEMS}/{item_id}/check", headers=who.h, json={"checked": on}
    )


def complete(client: Any, who: Actor, list_id: str, **body: Any) -> Any:
    return client.post(f"{LISTS}/{list_id}/complete", headers=who.h, json=body)


def lists_of(client: Any, who: Actor) -> list[dict]:
    res = client.get(LISTS, headers=who.h)
    assert res.status_code == 200, res.text
    return res.json()


def stock_of(client: Any, who: Actor) -> list[dict]:
    res = client.get(STOCK, headers=who.h)
    assert res.status_code == 200, res.text
    return res.json()


def txs_of(client: Any, who: Actor) -> list[dict]:
    res = client.get(f"{API}/transactions", headers=who.h)
    assert res.status_code == 200, res.text
    return res.json()


def one_list(client: Any, who: Actor, list_id: str) -> dict:
    found = [row for row in lists_of(client, who) if row["id"] == list_id]
    assert found, f"لیست {list_id} در پاسخ نیست"
    return found[0]


# ═══════════════════════════════════════════════════════════════════
#  احراز هویت
# ═══════════════════════════════════════════════════════════════════
def test_routes_require_auth(client: Any) -> None:
    assert_denied(client.get(LISTS), "GET لیست‌ها بی‌توکن")
    assert_denied(client.post(LISTS, json={"title": "x"}), "POST لیست بی‌توکن")
    assert_denied(client.patch(f"{LISTS}/{FAKE}", json={}), "PATCH لیست بی‌توکن")
    assert_denied(client.delete(f"{LISTS}/{FAKE}"), "DELETE لیست بی‌توکن")
    assert_denied(
        client.post(f"{LISTS}/{FAKE}/items", json={"title": "x"}), "افزودن بی‌توکن"
    )
    assert_denied(
        client.post(f"{LISTS}/{FAKE}/complete", json={}), "بستنِ سفر بی‌توکن"
    )
    assert_denied(
        client.post(f"{ITEMS}/{FAKE}/check", json={"checked": True}), "تیک بی‌توکن"
    )
    assert_denied(client.delete(f"{ITEMS}/{FAKE}"), "حذفِ قلم بی‌توکن")
    assert_denied(client.get(STOCK), "GET انبار بی‌توکن")
    assert_denied(client.post(STOCK, json={"title": "x"}), "POST انبار بی‌توکن")
    assert_denied(
        client.post(f"{STOCK}/{FAKE}/adjust", json={"delta": 1}), "adjust بی‌توکن"
    )


# ═══════════════════════════════════════════════════════════════════
#  مرزِ خانواده (RLS + شرطِ لایهٔ اپ)
# ═══════════════════════════════════════════════════════════════════
def test_other_household_cannot_see_or_touch(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"])
    item_stock = new_stock(client, home_a)

    assert lists_of(client, home_b) == []
    assert stock_of(client, home_b) == []

    assert_denied(
        client.patch(f"{LISTS}/{lst['id']}", headers=home_b.h, json={"title": "ز"}),
        "تغییرِ نامِ لیستِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.delete(f"{LISTS}/{lst['id']}", headers=home_b.h),
        "حذفِ لیستِ خانوادهٔ دیگر",
    )
    assert_denied(
        client.post(
            f"{LISTS}/{lst['id']}/items", headers=home_b.h, json={"title": "ز"}
        ),
        "افزودن به لیستِ خانوادهٔ دیگر",
    )
    assert_denied(
        check(client, home_b, item["id"]), "تیکِ قلمِ خانوادهٔ دیگر"
    )
    assert_denied(
        client.delete(f"{ITEMS}/{item['id']}", headers=home_b.h),
        "حذفِ قلمِ خانوادهٔ دیگر",
    )
    assert_denied(
        complete(client, home_b, lst["id"]), "بستنِ سفرِ خانوادهٔ دیگر"
    )
    assert_denied(
        client.post(
            f"{STOCK}/{item_stock['id']}/adjust", headers=home_b.h, json={"delta": 5}
        ),
        "تغییرِ انبارِ خانوادهٔ دیگر",
    )

    # و هیچ‌یک از آن تلاش‌ها نباید چیزی را عوض کرده باشد
    assert len(one_list(client, home_a, lst["id"])["items"]) == 1
    assert Decimal(stock_of(client, home_a)[0]["quantity"]) == Decimal("1")


def test_member_shares_the_household_list(
    client: Any, home_a: Actor
) -> None:
    """لیست خرید و انبار دادهٔ HOUSEHOLD_SHAREDِ §۵.۲ است.

    عضوِ عادی باید ببیند و بتواند اضافه کند و تیک بزند — همان استدلالی که
    قبض را هم بی‌گاردِ نقش گذاشت. اگر روزی این شکست، یعنی کسی ناخواسته
    گاردِ مدیر گذاشته.
    """
    lst = new_list(client, home_a)
    member = add_active_member(client, home_a, "همسر")

    assert [row["id"] for row in lists_of(client, member)] == [lst["id"]]
    item = new_item(client, member, lst["id"], title="شیر")
    expect_status(check(client, member, item["id"]), 200)
    assert one_list(client, home_a, lst["id"])["items"][0]["checked"] is True


# ═══════════════════════════════════════════════════════════════════
#  اعتبارسنجی
# ═══════════════════════════════════════════════════════════════════
def test_invalid_input_is_rejected(client: Any, home_a: Actor) -> None:
    res = client.post(LISTS, headers=home_a.h, json={"title": "   "})
    assert res.status_code == 422, res.text
    assert lists_of(client, home_a) == []

    lst = new_list(client, home_a)
    cases = {
        "نامِ خالی": {"title": "  "},
        "تعدادِ صفر": {"title": "نان", "qty": "0"},
        "تعدادِ منفی": {"title": "نان", "qty": "-1"},
        "قیمتِ منفی": {"title": "نان", "price": "-500"},
        "انبارِ ناموجود": {"title": "نان", "inventory_item_id": FAKE},
    }
    for what, body in cases.items():
        res = client.post(f"{LISTS}/{lst['id']}/items", headers=home_a.h, json=body)
        assert res.status_code in DENIED, f"«{what}» پذیرفته شد: {res.text}"
    assert one_list(client, home_a, lst["id"])["items"] == []


def test_zero_price_becomes_null_not_free(client: Any, home_a: Actor) -> None:
    """قیمتِ صفر یعنی «نگفتم»، نه «مجانی».

    قیدِ دیتابیس `price IS NULL OR price > 0` است، پس اگر سرویس صفر را به
    None تبدیل نکند، نوشتن می‌شکند (۵۰۰). و در سطحِ معنا هم «قیمت ندارم»
    باید از «صفر تومان» جدا بماند، وگرنه هشدارِ «جمع ناقص است» از کار
    می‌افتد.
    """
    lst = new_list(client, home_a)
    row = new_item(client, home_a, lst["id"], price="0")
    assert row["price"] is None, row


def test_state_cannot_be_set_through_write_body(client: Any, home_a: Actor) -> None:
    """`checked`/`bought_at` در بدنهٔ نوشتن نیستند و فرستادنشان بی‌اثر است.

    وگرنه کلاینت می‌توانست قلم را «خریده‌شده» کند بی‌آنکه خرجی ثبت شود یا
    انبار بالا برود — همان قاعدهٔ `BillWrite`.
    """
    lst = new_list(client, home_a)
    res = client.post(
        f"{LISTS}/{lst['id']}/items",
        headers=home_a.h,
        json={"title": "نان", "checked": True, "bought_at": "2026-10-01T00:00:00Z"},
    )
    expect_status(res, 201)
    row = res.json()
    assert row["checked"] is False, row
    assert row["bought_at"] is None, row


# ═══════════════════════════════════════════════════════════════════
#  یکتاییِ عنوان — دردِ واقعیِ لیستِ مشترک
# ═══════════════════════════════════════════════════════════════════
def test_duplicate_title_in_same_list_is_rejected(
    client: Any, home_a: Actor
) -> None:
    lst_a = new_list(client, home_a, "سوپرمارکت")
    lst_b = new_list(client, home_a, "داروخانه")
    new_item(client, home_a, lst_a["id"], title="شیر")

    res = client.post(
        f"{LISTS}/{lst_a['id']}/items", headers=home_a.h, json={"title": "شیر"}
    )
    assert res.status_code == 409, res.text
    # همان نام در لیستِ دیگر مشکلی ندارد
    new_item(client, home_a, lst_b["id"], title="شیر")
    # فاصله‌های اضافه هم همان نام شمرده می‌شوند
    res = client.post(
        f"{LISTS}/{lst_a['id']}/items", headers=home_a.h, json={"title": "  شیر  "}
    )
    assert res.status_code == 409, res.text


def test_same_title_allowed_again_after_bought(client: Any, home_a: Actor) -> None:
    """یکتایی فقط بینِ اقلامِ **نخریده** است.

    وگرنه «شیر» را یک‌بار می‌خریدی و هفتهٔ بعد دیگر نمی‌توانستی اضافه‌اش
    کنی — یعنی ردِ سابقه، لیست را فلج می‌کرد.
    """
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], title="شیر")
    expect_status(check(client, home_a, item["id"]), 200)
    expect_status(complete(client, home_a, lst["id"]), 200)

    new_item(client, home_a, lst["id"], title="شیر")


def test_inventory_duplicate_title_is_rejected(client: Any, home_a: Actor) -> None:
    """دو ردیفِ «برنج» با دو عدد، انبار را از معنا می‌انداخت."""
    new_stock(client, home_a, title="برنج")
    res = client.post(
        STOCK, headers=home_a.h, json={"title": "برنج", "quantity": "5"}
    )
    assert res.status_code == 409, res.text

    other = new_stock(client, home_a, title="شکر")
    res = client.patch(
        f"{STOCK}/{other['id']}", headers=home_a.h, json={"title": "برنج"}
    )
    assert res.status_code == 409, res.text
    # و تغییرِ نامِ خودش به خودش باید مجاز بماند
    res = client.patch(
        f"{STOCK}/{other['id']}",
        headers=home_a.h,
        json={"title": "شکر", "quantity": "3"},
    )
    expect_status(res, 200)


# ═══════════════════════════════════════════════════════════════════
#  بستنِ سفرِ خرید — قلبِ این ماژول
# ═══════════════════════════════════════════════════════════════════
def test_complete_creates_one_expense_and_closes_items(
    client: Any, home_a: Actor
) -> None:
    account = make_account(client, home_a)
    lst = new_list(client, home_a)
    a = new_item(client, home_a, lst["id"], title="نان", price="30000")
    b = new_item(client, home_a, lst["id"], title="شیر", price="70000")
    c = new_item(client, home_a, lst["id"], title="پنیر", price="50000")

    expect_status(check(client, home_a, a["id"]), 200)
    expect_status(check(client, home_a, b["id"]), 200)
    # «پنیر» تیک نخورده، پس نباید بسته شود و نباید در جمع بیاید

    res = complete(client, home_a, lst["id"], account_id=account)
    expect_status(res, 200)
    trip = res.json()

    assert trip["item_count"] == 2, trip
    assert Decimal(trip["total"]) == Decimal("100000"), trip
    assert trip["transaction_id"], trip

    # **یک** تراکنش، با مبلغِ جمع و دستهٔ خرید
    txs = txs_of(client, home_a)
    assert len(txs) == 1, txs
    assert Decimal(txs[0]["amount"]) == Decimal("100000"), txs[0]
    assert txs[0]["category"] == "shopping", txs[0]
    assert txs[0]["type"] == "expense", txs[0]
    assert txs[0]["id"] == trip["transaction_id"], (txs[0], trip)

    # اقلامِ بسته‌شده از لیست رفته‌اند و «پنیر» مانده
    remaining = one_list(client, home_a, lst["id"])["items"]
    assert [row["id"] for row in remaining] == [c["id"]], remaining
    # و پاسخِ خودِ سفر همان لیستِ به‌روز را برمی‌گرداند (کلاینت دوباره
    # نمی‌پرسد، پس اگر این دو یکی نباشند صفحه کهنه می‌ماند)
    assert [row["id"] for row in trip["list"]["items"]] == [c["id"]], trip["list"]


def test_complete_with_nothing_checked_changes_nothing(
    client: Any, home_a: Actor
) -> None:
    """۴۰۹ **و** هیچ تراکنشی — کدِ وضعیت به‌تنهایی کافی نیست."""
    lst = new_list(client, home_a)
    new_item(client, home_a, lst["id"], price="50000")

    res = complete(client, home_a, lst["id"])
    assert res.status_code == 409, res.text
    assert txs_of(client, home_a) == []
    assert len(one_list(client, home_a, lst["id"])["items"]) == 1


def test_completing_twice_does_not_double_count(client: Any, home_a: Actor) -> None:
    """دو لمسِ پشت‌سرهم نباید دو تراکنش بسازد.

    بارِ دوم چیزی تیک‌خورده نمانده (اقلام بسته شده‌اند)، پس ۴۰۹ می‌گیرد و
    خرجِ ماه دو برابر نمی‌شود.
    """
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], price="80000")
    expect_status(check(client, home_a, item["id"]), 200)

    expect_status(complete(client, home_a, lst["id"]), 200)
    assert len(txs_of(client, home_a)) == 1

    assert complete(client, home_a, lst["id"]).status_code == 409
    assert len(txs_of(client, home_a)) == 1


def test_trip_without_prices_closes_but_records_no_expense(
    client: Any, home_a: Actor
) -> None:
    """لیستِ بی‌قیمت هم باید بسته شود، و تراکنشِ صفرتومانی نسازد.

    (`transactions._prepare` هم مبلغِ صفر را رد می‌کند، پس اگر سرویس جمعِ
    صفر را فیلتر نکند، بستنِ سفر ۴۲۲ می‌شد.)
    """
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"])
    expect_status(check(client, home_a, item["id"]), 200)

    res = complete(client, home_a, lst["id"])
    expect_status(res, 200)
    trip = res.json()
    assert trip["transaction_id"] is None, trip
    assert Decimal(trip["total"]) == Decimal("0"), trip
    assert trip["item_count"] == 1, trip
    assert txs_of(client, home_a) == []
    assert one_list(client, home_a, lst["id"])["items"] == []


def test_create_transaction_false_skips_the_expense(
    client: Any, home_a: Actor
) -> None:
    """«خرجش را ثبت نکن» — مثلاً وقتی کسِ دیگری حساب کرده."""
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], price="90000")
    expect_status(check(client, home_a, item["id"]), 200)

    res = complete(client, home_a, lst["id"], create_transaction=False)
    expect_status(res, 200)
    assert res.json()["transaction_id"] is None, res.text
    assert txs_of(client, home_a) == []
    # ولی قلم بسته شده است
    assert one_list(client, home_a, lst["id"])["items"] == []


def test_unchecking_removes_item_from_the_trip(client: Any, home_a: Actor) -> None:
    """تیک برگشت‌پذیر است و تا بستنِ سفر هیچ خرجی ثبت نشده."""
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], price="40000")
    expect_status(check(client, home_a, item["id"], True), 200)
    expect_status(check(client, home_a, item["id"], False), 200)

    assert complete(client, home_a, lst["id"]).status_code == 409
    assert txs_of(client, home_a) == []


# ═══════════════════════════════════════════════════════════════════
#  پیوندِ انبار
# ═══════════════════════════════════════════════════════════════════
def test_completing_trip_raises_linked_inventory(
    client: Any, home_a: Actor
) -> None:
    """خریدنِ قلمِ پیوندخورده موجودیِ انبار را به اندازهٔ `qty` بالا می‌برد.

    و قلمِ بی‌پیوند نباید هیچ ردیفی را دست بزند.
    """
    rice = new_stock(client, home_a, title="برنج", quantity="1", threshold="2")
    sugar = new_stock(client, home_a, title="شکر", quantity="4", threshold="1")

    lst = new_list(client, home_a)
    linked = new_item(
        client,
        home_a,
        lst["id"],
        title="برنج",
        qty="3",
        price="500000",
        inventory_item_id=rice["id"],
    )
    plain = new_item(client, home_a, lst["id"], title="نان", price="20000")
    expect_status(check(client, home_a, linked["id"]), 200)
    expect_status(check(client, home_a, plain["id"]), 200)

    expect_status(complete(client, home_a, lst["id"]), 200)

    rows = {row["id"]: row for row in stock_of(client, home_a)}
    assert Decimal(rows[rice["id"]]["quantity"]) == Decimal("4"), rows[rice["id"]]
    assert Decimal(rows[sugar["id"]]["quantity"]) == Decimal("4"), rows[sugar["id"]]


def test_inventory_unit_is_inherited_when_absent(
    client: Any, home_a: Actor
) -> None:
    """واحد از انبار به ارث می‌رسد — دو واحدِ متفاوت برای یک چیز گیج‌کننده بود."""
    rice = new_stock(client, home_a, title="برنج", unit="کیلو")
    lst = new_list(client, home_a)
    row = new_item(
        client, home_a, lst["id"], title="برنج", inventory_item_id=rice["id"]
    )
    assert row["unit"] == "کیلو", row
    # ولی اگر کاربر خودش واحد داده باشد، دست نمی‌خورد
    row2 = new_item(
        client,
        home_a,
        lst["id"],
        title="برنج دودی",
        unit="بسته",
        inventory_item_id=rice["id"],
    )
    assert row2["unit"] == "بسته", row2


def test_deleting_inventory_keeps_the_shopping_item(
    client: Any, home_a: Actor
) -> None:
    """`SET NULL` — حذفِ ردیفِ انبار نباید قلمِ لیست را ببرد، فقط پیوند را."""
    rice = new_stock(client, home_a, title="برنج")
    lst = new_list(client, home_a)
    item = new_item(
        client, home_a, lst["id"], title="برنج", inventory_item_id=rice["id"]
    )
    expect_status(client.delete(f"{STOCK}/{rice['id']}", headers=home_a.h), 204)

    rows = one_list(client, home_a, lst["id"])["items"]
    assert [row["id"] for row in rows] == [item["id"]], rows
    assert rows[0]["inventory_item_id"] is None, rows[0]


# ═══════════════════════════════════════════════════════════════════
#  قلمِ خریده‌شده دست‌نخورده می‌ماند
# ═══════════════════════════════════════════════════════════════════
def test_bought_item_cannot_be_edited_or_deleted(
    client: Any, home_a: Actor
) -> None:
    """قیمتش با تراکنشش هم‌خوان است — همان ۴۰۹ـی که قبضِ پرداخت‌شده می‌دهد."""
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], price="60000")
    expect_status(check(client, home_a, item["id"]), 200)
    expect_status(complete(client, home_a, lst["id"]), 200)

    res = client.patch(
        f"{ITEMS}/{item['id']}", headers=home_a.h, json={"title": "نانِ دیگر"}
    )
    assert res.status_code == 409, res.text
    assert client.delete(f"{ITEMS}/{item['id']}", headers=home_a.h).status_code == 409
    assert check(client, home_a, item["id"], False).status_code == 409
    # و تراکنش سرِ جایش است
    assert len(txs_of(client, home_a)) == 1


def test_deleting_list_keeps_the_recorded_expense(
    client: Any, home_a: Actor
) -> None:
    """اقلام با CASCADE می‌روند ولی خرجِ ثبت‌شده در گزارش‌ها می‌ماند."""
    lst = new_list(client, home_a)
    item = new_item(client, home_a, lst["id"], price="75000")
    expect_status(check(client, home_a, item["id"]), 200)
    expect_status(complete(client, home_a, lst["id"]), 200)

    expect_status(client.delete(f"{LISTS}/{lst['id']}", headers=home_a.h), 204)
    assert lists_of(client, home_a) == []
    assert len(txs_of(client, home_a)) == 1


# ═══════════════════════════════════════════════════════════════════
#  انبار — تغییرِ نسبی و معنیِ آستانهٔ صفر
# ═══════════════════════════════════════════════════════════════════
def test_adjust_is_relative_and_clamps_at_zero(client: Any, home_a: Actor) -> None:
    row = new_stock(client, home_a, quantity="2", threshold="1")

    res = client.post(f"{STOCK}/{row['id']}/adjust", headers=home_a.h, json={"delta": 3})
    expect_status(res, 200)
    assert Decimal(res.json()["quantity"]) == Decimal("5"), res.text

    res = client.post(
        f"{STOCK}/{row['id']}/adjust", headers=home_a.h, json={"delta": -2}
    )
    expect_status(res, 200)
    assert Decimal(res.json()["quantity"]) == Decimal("3"), res.text

    # منفی‌شدن به صفر گرفته می‌شود، نه خطا: «−» پشت‌سرهم یعنی «تمام شد»
    res = client.post(
        f"{STOCK}/{row['id']}/adjust", headers=home_a.h, json={"delta": -99}
    )
    expect_status(res, 200)
    assert Decimal(res.json()["quantity"]) == Decimal("0"), res.text


def test_inventory_order_puts_low_items_first(client: Any, home_a: Actor) -> None:
    """ترتیب در سرور تعیین می‌شود تا صفحهٔ انبار و کاشیِ هاب یکی ببینند.

    و **آستانهٔ صفر «کم» نیست**: قلمی که کاربر آستانه‌اش را نگذاشته نباید
    بالای فهرست بیاید، حتی با موجودیِ صفر.
    """
    new_stock(client, home_a, title="الف", quantity="0", threshold="0")
    new_stock(client, home_a, title="ب", quantity="10", threshold="2")
    new_stock(client, home_a, title="پ", quantity="1", threshold="3")

    titles = [row["title"] for row in stock_of(client, home_a)]
    assert titles[0] == "پ", titles
    assert set(titles[1:]) == {"الف", "ب"}, titles


def test_negative_inventory_values_are_rejected(client: Any, home_a: Actor) -> None:
    for body in (
        {"title": "x", "quantity": "-1"},
        {"title": "y", "threshold": "-2"},
    ):
        res = client.post(STOCK, headers=home_a.h, json=body)
        assert res.status_code == 422, res.text
    assert stock_of(client, home_a) == []


# ═══════════════════════════════════════════════════════════════════
#  شکلِ پاسخ
# ═══════════════════════════════════════════════════════════════════
def test_list_payload_contains_only_pending_items(
    client: Any, home_a: Actor
) -> None:
    """اقلامِ خریده‌شده در پاسخ نمی‌آیند (ردیفشان در دیتابیس می‌ماند).

    لیستِ خرید جایِ «چه بخریم» است نه آرشیو؛ سابقهٔ پول در خودِ تراکنش است.
    """
    lst = new_list(client, home_a)
    kept = new_item(client, home_a, lst["id"], title="پنیر")
    gone = new_item(client, home_a, lst["id"], title="نان", price="20000")
    expect_status(check(client, home_a, gone["id"]), 200)
    expect_status(complete(client, home_a, lst["id"]), 200)

    rows = one_list(client, home_a, lst["id"])["items"]
    assert [row["id"] for row in rows] == [kept["id"]], rows


def test_pending_items_are_sorted_unchecked_first(
    client: Any, home_a: Actor
) -> None:
    lst = new_list(client, home_a)
    first = new_item(client, home_a, lst["id"], title="الف")
    new_item(client, home_a, lst["id"], title="ب")
    expect_status(check(client, home_a, first["id"]), 200)

    titles = [row["title"] for row in one_list(client, home_a, lst["id"])["items"]]
    assert titles == ["ب", "الف"], titles
