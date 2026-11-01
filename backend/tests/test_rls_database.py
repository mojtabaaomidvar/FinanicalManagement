"""§5.10 — RLS در خودِ دیتابیس: مرزِ خانواده فقط یک `if` در پایتون نباشد.

تست‌های ایزولهٔ دیگر از راه HTTP می‌روند و «رفتار» را می‌سنجند. این فایل یک لایه
پایین‌تر می‌ایستد و «ساختار» را می‌سنجد: آیا پالیسی‌های مهاجرت 0002/0004/0005
واقعاً روی دیتابیسِ زنده نشسته‌اند؟

چرا جداگانه؟ چون این دو نوع خرابیِ کاملاً متفاوت را می‌گیرند:

  • تستِ HTTP سبز می‌ماند حتی اگر RLS کلاً خاموش شود — تا وقتی کدِ پایتون درست
    فیلتر می‌کند. یعنی «شبکهٔ ایمنیِ دوم» بی‌صدا می‌افتد و کسی نمی‌فهمد.
  • برعکس، یک جدولِ تازه با ستون family_id که کسی یادش برود پالیسی برایش بنویسد،
    از دید تستِ HTTP سالم است چون هنوز روتی ندارد — ولی همان روز که روت پیدا کند
    نشت می‌کند.

پس اینجا مستقیم از کاتالوگِ پستگرس می‌پرسیم، نه از اپ.

دامنه: فقط سنجش وضعِ امروز. هیچ مهاجرتی نوشته/اجرا نمی‌شود (مرحلهٔ A).
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import (
    API,
    Actor,
    accept_invite,
    create_invite_token,
    make_account,
    make_category_budget,
    make_custom_category,
    make_event,
    make_holding,
    make_subcategory,
    make_transaction,
    next_phone,
)

# جدول‌هایی که «باید» زیر RLSِ خانواده باشند (0002 + 0004 + 0005 + 0006 + 0009
# + 0010 + 0011).
#
# ⚠️ `join_requests` (مهاجرتِ 0006) و `bills`/`notification_dismissals`
# (مهاجرتِ 0009/0010) تا ۱۴۰۵/۰۷/۲۱ **از این فهرست جا افتاده بودند** — یعنی
# `test_every_family_id_table_is_classified` از همان زمان قرمز بود و کسی ندیده
# بود، چون اجرای `python -m pytest` روی پستگرس (کارِ سمتِ مالک) هنوز انجام
# نشده. همان تله‌ای که خودِ این فایل برای گرفتنش نوشته شده بود، سرِ خودمان
# آمد. با هر جدولِ تازهٔ دارای `family_id`، **هم‌زمان** این فهرست و تابعِ
# `_populate` باید به‌روز شوند.
PROTECTED: tuple[str, ...] = (
    "accounts",
    "bills",
    "category_budgets",
    "custom_categories",
    "family_events",
    "holdings",
    "inventory_items",
    "join_requests",
    "notification_dismissals",
    "shopping_items",
    "shopping_lists",
    "sms_messages",
    "sms_numbers",
    "sms_senders",
    "subcategories",
    "transaction_photos",
    "transactions",
)

# جدول‌هایی که ستون family_id دارند ولی «عمداً» بیرون از RLS مانده‌اند.
# هر کدام دلیلِ مکتوب دارد؛ این دیکشنری همان دلیل را کنارِ تست نگه می‌دارد تا
# بازنویسیِ بعدی نتواند بگوید «لابد یادشان رفته».
EXEMPT: dict[str, str] = {
    "members": "بوت‌استرپِ هویت: پیش از داشتن زمینهٔ خانواده خوانده می‌شود (0002).",
    "family_invites": "جدولِ قابلیت: با توکنِ غیرقابل‌حدس پیش از هر زمینه‌ای باز می‌شود (0002).",
    "sms_bridges": "جدولِ قابلیت: bridge-ingest با توکنِ پل احراز می‌شود، نه با نشست (0003).",
}

POLICY_SUFFIX = "_family_isolation"

# تکه‌های محمولِ fail-closed. عمداً «تکه» می‌سنجیم نه رشتهٔ کامل، چون پستگرس
# محمول را بازچاپ می‌کند (پرانتز و کست‌ها عوض می‌شوند) و مقایسهٔ کلمه‌به‌کلمه
# تستی شکننده می‌سازد که با هر نسخهٔ پستگرس می‌شکند بی‌آنکه چیزی خراب شده باشد.
PREDICATE_PARTS = ("family_id", "app.family_id", "current_setting", "NULLIF")


# ═══════════════════════════════════════════════════════════════════
#  کمک‌کارها
# ═══════════════════════════════════════════════════════════════════
def _count(conn: Any, table: str) -> int:
    # نامِ جدول از ثابتِ همین فایل می‌آید، نه از ورودیِ کاربر؛ پس درون‌ریزیِ رشته
    # اینجا بی‌خطر است (و نامِ جدول را نمی‌شود پارامتر bind کرد).
    return int(conn.execute(text(f'SELECT count(*) FROM "{table}"')).scalar_one())  # noqa: S608


def _set_family(conn: Any, family_id: str | None) -> None:
    """زمینهٔ خانواده را دستی روی همین اتصالِ خام می‌گذارد (سطحِ نشست، نه تراکنش)."""
    conn.execute(
        text("SELECT set_config('app.family_id', :fid, false)"),
        {"fid": "" if family_id is None else str(family_id)},
    )


def _role_is_exempt_from_rls(conn: Any) -> bool:
    row = conn.execute(
        text("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
    ).first()
    return bool(row is not None and (row[0] or row[1]))


def _skip_if_role_bypasses(conn: Any) -> None:
    if _role_is_exempt_from_rls(conn):
        pytest.skip(
            "نقشِ اتصال از RLS معاف است (superuser یا BYPASSRLS)، پس این سنجش چیزی "
            "را ثابت نمی‌کند. علتِ اصلی را test_connection_role_is_not_exempt_from_rls "
            "گزارش می‌کند."
        )


def _populate(client: Any, who: Actor) -> None:
    """در **هر** جدولِ محافظت‌شده دستِ‌کم یک ردیف می‌سازد (از راه API عمومی).

    وجودِ این داده است که تستِ «بدون زمینه صفر ردیف» را از یک تستِ توخالی به یک
    سنجشِ واقعی تبدیل می‌کند: جدولِ خالی هم صفر ردیف می‌دهد.

    پس با افزودنِ هر جدول به `PROTECTED`، این‌جا هم باید ردیفش ساخته شود —
    وگرنه «شاهدِ مثبت» پایینِ فایل قرمز می‌شود.
    """
    acc = make_account(client, who, "حسابِ سنجشِ RLS")
    tx = make_transaction(client, who)
    make_event(client, who, "رویدادِ سنجشِ RLS")
    make_holding(client, who)
    make_subcategory(client, who, "نانِ سنجش")
    make_custom_category(client, who, "باشگاهِ سنجش")
    make_category_budget(client, who)  # فقط مدیر مجاز است

    photo = client.post(
        f"{API}/transactions/{tx}/photos",
        headers=who.h,
        json={"url": "https://example.test/rls-probe.jpg", "caption": "رسید"},
    )
    assert photo.status_code == 201, photo.text

    sms = client.post(
        f"{API}/sms",
        headers=who.h,
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
    assert sms.status_code == 200 and sms.json() == 1, sms.text

    sender = client.post(
        f"{API}/sms/accounts/{acc}/senders", headers=who.h, json={"sender": "110000"}
    )
    assert sender.status_code == 201, sender.text

    number = client.post(
        f"{API}/sms/numbers", headers=who.h, json={"phone": "09121234567", "label": "همراهِ دوم"}
    )
    assert number.status_code == 201, number.text

    # ── §۱.۹ قبوض ──
    bill = client.post(
        f"{API}/bills",
        headers=who.h,
        json={
            "kind": "electricity",
            "title": "برقِ سنجشِ RLS",
            "amount": "100000",
            "due_date": "2026-11-15",
        },
    )
    assert bill.status_code == 201, bill.text

    # ── §۷ نادیده‌گرفتنِ اعلان ──
    dismissal = client.post(
        f"{API}/notifications/dismissals", headers=who.h, json={"key": "event:rls:probe"}
    )
    assert dismissal.status_code == 204, dismissal.text

    # ── §۱.۸ خرید و انبار ──
    stock = client.post(
        f"{API}/inventory",
        headers=who.h,
        json={"title": "برنجِ سنجشِ RLS", "quantity": "1", "threshold": "2"},
    )
    assert stock.status_code == 201, stock.text

    shopping_list = client.post(
        f"{API}/shopping/lists", headers=who.h, json={"title": "لیستِ سنجشِ RLS"}
    )
    assert shopping_list.status_code == 201, shopping_list.text

    shopping_item = client.post(
        f"{API}/shopping/lists/{shopping_list.json()['id']}/items",
        headers=who.h,
        json={"title": "نانِ سنجشِ RLS"},
    )
    assert shopping_item.status_code == 201, shopping_item.text

    # ── مرحلهٔ B: یک درخواستِ عضویتِ «در انتظار» ──
    # عمداً تأیید نمی‌شود: برای سنجشِ RLS فقط وجودِ **ردیف** لازم است، و
    # درخواستِ تأییدنشده عضوِ فعالِ اضافه‌ای هم نمی‌سازد که بقیهٔ شمارش‌ها
    # را جابه‌جا کند.
    joined = accept_invite(
        client,
        create_invite_token(client, who),
        name="متقاضیِ سنجشِ RLS",
        phone=next_phone(),
    )
    assert joined.status_code == 200, joined.text


# ═══════════════════════════════════════════════════════════════════
#  ۱) هیچ جدولی با family_id از قلم نیفتد
# ═══════════════════════════════════════════════════════════════════
def test_every_family_id_table_is_classified(raw_sql: Any) -> None:
    """تله‌ی اصلیِ این فایل: جدولِ تازه با ستون family_id و بدون پالیسی.

    اگر روزی کسی جدولی با family_id بسازد و پالیسی ننویسد، اینجا قرمز می‌شود —
    پیش از آنکه روتی برایش نوشته شود و نشت واقعی شود.
    """
    found = set(
        raw_sql.execute(
            text(
                "SELECT table_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND column_name = 'family_id'"
            )
        )
        .scalars()
        .all()
    )
    known = set(PROTECTED) | set(EXEMPT)

    unclassified = sorted(found - known)
    assert not unclassified, (
        f"این جدول‌ها ستون family_id دارند ولی در هیچ فهرستی نیستند: {unclassified}. "
        "یا برایشان پالیسی RLS بنویس، یا با دلیلِ مکتوب به EXEMPT اضافه‌شان کن."
    )

    vanished = sorted(known - found)
    assert not vanished, f"این جدول‌ها دیگر ستون family_id ندارند (یا حذف شده‌اند): {vanished}"


# ═══════════════════════════════════════════════════════════════════
#  ۲) ساختار: ENABLE + FORCE + پالیسی
# ═══════════════════════════════════════════════════════════════════
@pytest.mark.parametrize("table", PROTECTED)
def test_protected_tables_have_rls_enabled_and_forced(raw_sql: Any, table: str) -> None:
    """FORCE هم لازم است، نه فقط ENABLE.

    اپ امروز با «مالکِ» جدول‌ها وصل می‌شود و مالک به‌صورت پیش‌فرض از RLS معاف
    است. بدون FORCE، پالیسی‌ها روی کاغذ هستند و در عمل هیچ‌وقت اجرا نمی‌شوند.
    """
    row = raw_sql.execute(
        text(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid = to_regclass(:t)"
        ),
        {"t": f"public.{table}"},
    ).first()

    assert row is not None, f"جدول «{table}» اصلاً وجود ندارد."
    assert row[0] is True, f"RLS روی «{table}» خاموش است (ENABLE ROW LEVEL SECURITY نشده)."
    assert row[1] is True, (
        f"RLS روی «{table}» FORCE نشده؛ چون اپ با نقشِ مالک وصل می‌شود، "
        "پالیسی‌ها برایش اجرا نمی‌شوند."
    )


@pytest.mark.parametrize("table", PROTECTED)
def test_protected_tables_have_a_fail_closed_family_policy(raw_sql: Any, table: str) -> None:
    rows = raw_sql.execute(
        text(
            "SELECT policyname, permissive, cmd, qual, with_check FROM pg_policies "
            "WHERE schemaname = 'public' AND tablename = :t"
        ),
        {"t": table},
    ).all()

    assert rows, f"جدول «{table}» هیچ پالیسی‌ای ندارد — با RLSِ روشن یعنی کلاً بسته، نه ایزوله."

    name = f"{table}{POLICY_SUFFIX}"
    match = [r for r in rows if r[0] == name]
    assert match, f"پالیسیِ «{name}» نیست. پالیسی‌های موجود: {[r[0] for r in rows]}"

    _, permissive, cmd, qual, with_check = match[0]
    assert permissive == "PERMISSIVE", f"پالیسیِ «{name}» permissive نیست: {permissive}"
    assert cmd == "ALL", f"پالیسیِ «{name}» فقط برای «{cmd}» است؛ باید FOR ALL باشد."

    # USING مرزِ خواندن است و WITH CHECK مرزِ نوشتن. اگر WITH CHECK نباشد، می‌شود
    # ردیفی با family_id خانوادهٔ دیگر INSERT کرد — نشتِ خاموش و یک‌طرفه.
    assert qual, f"پالیسیِ «{name}» محمولِ USING ندارد."
    assert with_check, f"پالیسیِ «{name}» محمولِ WITH CHECK ندارد — مرزِ نوشتن باز است."

    # بی‌تفاوت به بزرگی/کوچکی: پستگرس محمول را بازچاپ می‌کند و شکلِ چاپش قراردادِ
    # پایدارِ ما نیست؛ چیزی که اهمیت دارد حضورِ خودِ اجزاست.
    for part in PREDICATE_PARTS:
        low = part.casefold()
        assert low in qual.casefold(), f"محمولِ USING در «{name}» تکهٔ «{part}» را ندارد: {qual}"
        assert low in with_check.casefold(), (
            f"محمولِ WITH CHECK در «{name}» تکهٔ «{part}» را ندارد: {with_check}"
        )


@pytest.mark.parametrize("table", sorted(EXEMPT))
def test_exempt_tables_are_a_deliberate_short_list(raw_sql: Any, table: str) -> None:
    """این سه جدول عمداً RLS ندارند؛ مرزشان کاملاً لایهٔ اپ است.

    تست برعکسِ بقیه است: اگر روزی کسی روی این‌ها RLS روشن کند، مسیرِ بوت‌استرپ
    (ورود، پذیرشِ دعوت، ingest با توکنِ پل) بی‌صدا می‌شکند — چون در آن لحظه هنوز
    زمینهٔ خانواده وجود ندارد و محمولِ fail-closed صفر ردیف می‌دهد. پس همین‌جا
    قفلش می‌کنیم تا تغییرش «تصمیم» باشد نه «اتفاق».

    توجه: نبودِ RLS یعنی ایزولهٔ این جدول‌ها فقط با تست‌های HTTP اثبات می‌شود —
    همان چیزی که test_tenant_isolation.py پوشش می‌دهد.
    """
    row = raw_sql.execute(
        text(
            "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
            "WHERE oid = to_regclass(:t)"
        ),
        {"t": f"public.{table}"},
    ).first()
    assert row is not None, f"جدول «{table}» وجود ندارد."
    assert row[0] is False, (
        f"روی «{table}» RLS روشن شده، ولی این جدول عمداً بیرون از RLS بود "
        f"({EXEMPT[table]}) — مسیرِ بوت‌استرپ می‌شکند."
    )

    policies = (
        raw_sql.execute(
            text("SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=:t"),
            {"t": table},
        )
        .scalars()
        .all()
    )
    assert not policies, f"«{table}» پالیسیِ بی‌اثر دارد: {policies}"


# ═══════════════════════════════════════════════════════════════════
#  ۳) نقشِ اتصال نباید از RLS معاف باشد
# ═══════════════════════════════════════════════════════════════════
def test_connection_role_is_not_exempt_from_rls(raw_sql: Any) -> None:
    """superuser و BYPASSRLS از RLS رد می‌شوند — حتی با FORCE.

    یعنی اگر اپ با چنین نقشی وصل شود، تمامِ لایهٔ RLS تزئینی است. این تنها تستِ
    این فایل است که به «محیط» کار دارد نه به کد؛ اگر اینجا قرمز شد، اشکال در
    کاربرِ دیتابیسِ تست/تولید است نه در مهاجرت‌ها.
    """
    row = raw_sql.execute(
        text(
            "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles "
            "WHERE rolname = current_user"
        )
    ).first()
    assert row is not None, "نقشِ جاری در pg_roles پیدا نشد."

    name, is_super, bypass = row
    assert not is_super, (
        f"اپ با نقشِ superuser («{name}») وصل می‌شود؛ RLS برای superuser اصلاً "
        "اعمال نمی‌شود و همهٔ پالیسی‌ها بی‌اثرند."
    )
    assert not bypass, f"نقشِ «{name}» ویژگیِ BYPASSRLS دارد؛ پالیسی‌ها برایش اجرا نمی‌شوند."


# ═══════════════════════════════════════════════════════════════════
#  ۴) رفتار: fail-closed و تفکیکِ واقعی
# ═══════════════════════════════════════════════════════════════════
def test_without_family_context_every_protected_table_is_empty(
    client: Any, raw_sql: Any, home_a: Actor
) -> None:
    """بدونِ `app.family_id`، هیچ جدولِ محافظت‌شده‌ای حتی یک ردیف نمی‌دهد."""
    _populate(client, home_a)
    _skip_if_role_bypasses(raw_sql)

    for table in PROTECTED:
        assert _count(raw_sql, table) == 0, (
            f"«{table}» بدونِ زمینهٔ خانواده ردیف داد — محمول fail-closed نیست."
        )

    # شاهدِ مثبت: با زمینهٔ درست، همان جدول‌ها داده دارند. بدونِ این بخش، تستِ
    # بالا با یک دیتابیسِ خالی هم سبز می‌شد و هیچ‌چیز را ثابت نمی‌کرد.
    _set_family(raw_sql, home_a.family_id)
    for table in PROTECTED:
        assert _count(raw_sql, table) >= 1, (
            f"«{table}» با زمینهٔ درست هم خالی است؛ یعنی سنجشِ بالا توخالی بود."
        )
    _set_family(raw_sql, None)


def test_wrong_family_context_sees_nothing(
    client: Any, raw_sql: Any, home_a: Actor, home_b: Actor
) -> None:
    """پالیسی باید «تفکیک» کند، نه اینکه همیشه خالی برگرداند."""
    _populate(client, home_a)
    _skip_if_role_bypasses(raw_sql)

    _set_family(raw_sql, home_b.family_id)
    for table in PROTECTED:
        assert _count(raw_sql, table) == 0, f"خانوادهٔ ب ردیفِ «{table}» خانوادهٔ الف را دید."

    _set_family(raw_sql, home_a.family_id)
    assert _count(raw_sql, "transactions") >= 1
    _set_family(raw_sql, None)


def test_empty_family_context_does_not_crash(client: Any, raw_sql: Any, home_a: Actor) -> None:
    """زمینهٔ «رشتهٔ خالی» باید صفر ردیف بدهد، نه خطای کستِ uuid.

    دلیلِ وجودِ NULLIF در محمول دقیقاً همین است: `''::uuid` در پستگرس خطاست و
    آن خطا از پایینِ پشته بالا می‌آمد و به‌جای «دسترسی ندارد»، ۵۰۰ می‌داد.
    """
    make_transaction(client, home_a)
    _skip_if_role_bypasses(raw_sql)

    _set_family(raw_sql, "")
    assert _count(raw_sql, "transactions") == 0
    _set_family(raw_sql, None)


def test_family_context_does_not_leak_through_the_connection_pool(
    client: Any, home_a: Actor
) -> None:
    """زمینه باید transaction-local بماند و با اتصالِ بازگشته به استخر نرود.

    `app/db/rls.py` عمداً `set_config(..., true)` می‌زند. اگر روزی کسی آن را به
    `false` تغییر دهد «تا مطمئن‌تر باشد»، زمینهٔ خانوادهٔ الف روی اتصالی می‌ماند
    که درخواستِ بعدی از استخر برمی‌دارد — و آن درخواست دادهٔ الف را می‌بیند.
    """
    make_transaction(client, home_a)

    from app.db.session import engine

    for attempt in range(4):
        with engine.connect() as conn:
            leaked = conn.execute(text("SELECT current_setting('app.family_id', true)")).scalar()
            assert not leaked, (
                f"اتصالِ استخر (تلاشِ {attempt + 1}) زمینهٔ خانوادهٔ قبلی را نگه داشته: {leaked}"
            )
            if not _role_is_exempt_from_rls(conn):
                assert _count(conn, "transactions") == 0, (
                    "اتصالِ تازه از استخر دادهٔ خانوادهٔ قبلی را دید."
                )
