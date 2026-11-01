"""§۷ — مرزِ مسیرهای اعلان (`/notifications/*`).

این فایل سه چیز را می‌سنجد و هر سه ریشه در یک تصمیمِ معماری دارند:

**۱) دو خانوادهٔ مسیر در یک روتر.** مرحلهٔ C عمداً دو نوع وابستگی را در
`routes/notifications.py` کنارِ هم گذاشت:
  * `prefs` ستونِ `members` است و آن جدول **از RLS مستثنا** است →
    `get_current_member`، مرز در لایهٔ اپ.
  * `dismissals` جدولِ **زیرِ RLS** است → `get_tenant_member`، مرز در
    خودِ دیتابیس.
اشتباهِ ساده (یکی‌کردنِ وابستگی برای کلِ روتر) یکی از این دو مرز را
بی‌صدا باز می‌کند، و هیچ تستِ موجودی آن را نمی‌گیرد. تست‌های بخشِ «مرز».

**۲) اعلان‌ها ذخیره نمی‌شوند.** فقط ترجیح و «نادیده گرفتم» ماندگارند، پس
همین دو تا کلِ سطحِ حملهٔ §۷ هستند.

**۳) «غایب» با «خالی» یکی نیست.** PATCH جزئی است: فرستادنِ `enabled`
نباید نقشهٔ `domains` را پاک کند. اگر این بشکند، کاربر با روشن‌کردنِ
دوبارهٔ کلیدِ کلی همهٔ تنظیماتِ per-domainش را از دست می‌دهد — خرابیِ
بی‌صدا، چون هیچ خطایی نمی‌دهد.

⚠️ هیچ‌کدام از این تست‌ها به شبکه وصل نمی‌شود و هیچ کلیدِ واقعی لازم ندارد.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import (
    API,
    Actor,
    add_active_member,
)

PREFS = f"{API}/notifications/prefs"
DISMISS = f"{API}/notifications/dismissals"

# «رد شدن» یعنی درخواست کارساز نبود؛ شکلِ ردش قراردادِ محصول است نه مرزِ امنیت.
DENIED = {400, 401, 403, 404, 409, 422}


def assert_denied(res: Any, what: str) -> None:
    assert res.status_code in DENIED, (
        f"نشتِ مرز در «{what}» — کد {res.status_code} برگشت: {res.text[:300]}"
    )


def keys(res: Any) -> set[str]:
    return set(res.json()["dismissed"])


# ═══════════════════════════════════════════════════════════════════
#  احراز هویت — هیچ مسیری بی‌توکن باز نیست
# ═══════════════════════════════════════════════════════════════════
def test_all_notification_routes_require_auth(client: Any) -> None:
    assert_denied(client.get(PREFS), "GET prefs بی‌توکن")
    assert_denied(client.patch(PREFS, json={"enabled": False}), "PATCH prefs بی‌توکن")
    assert_denied(client.post(DISMISS, json={"key": "event:x:2026-01-01"}), "POST بی‌توکن")
    assert_denied(client.delete(f"{DISMISS}/event:x:2026-01-01"), "DELETE بی‌توکن")


# ═══════════════════════════════════════════════════════════════════
#  پیش‌فرض‌ها — ردیفِ تازه بی‌هیچ backfill درست کار کند
# ═══════════════════════════════════════════════════════════════════
def test_fresh_member_starts_enabled_with_empty_maps(client: Any, home_a: Actor) -> None:
    """ستونِ JSONB پیش‌فرضِ `'{}'` دارد، پس نقشه‌ها خالی‌اند و این درست است:
    قاعده‌های سمتِ کلاینت «کلیدِ غایب» را روشن می‌گیرند. چیزی که *نباید*
    بشود این است که سرور خودش نقشه را پر کند و ترجیحِ کاربر را جعل کند."""
    res = client.get(PREFS, headers=home_a.h)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["enabled"] is True, "اعلان باید پیش‌فرض روشن باشد"
    assert body["domains"] == {}, "سرور نباید ترجیحِ ثبت‌نشده را از خودش بسازد"
    assert body["lead_days"] == {}
    assert body["dismissed"] == []


# ═══════════════════════════════════════════════════════════════════
#  PATCH جزئی — «غایب» یعنی دست نزن
# ═══════════════════════════════════════════════════════════════════
def test_patch_is_partial_and_does_not_wipe_other_fields(
    client: Any, home_a: Actor
) -> None:
    first = client.patch(
        PREFS, headers=home_a.h, json={"domains": {"event": False}, "lead_days": {"event": 14}}
    )
    assert first.status_code == 200, first.text
    assert first.json()["domains"] == {"event": False}
    assert first.json()["lead_days"] == {"event": 14}

    # فقط کلیدِ کلی را عوض می‌کنیم — نقشه‌ها باید سرِ جایشان بمانند.
    second = client.patch(PREFS, headers=home_a.h, json={"enabled": False})
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["enabled"] is False
    assert body["domains"] == {"event": False}, (
        "خاموش‌کردنِ کلیدِ کلی نقشهٔ دامنه‌ها را پاک کرد — "
        "کاربر با روشن‌کردنِ دوباره تنظیماتش را از دست می‌دهد"
    )
    assert body["lead_days"] == {"event": 14}

    # و روشن‌کردنِ دوباره هم چیزی را برنمی‌گرداند/نمی‌برد.
    third = client.patch(PREFS, headers=home_a.h, json={"enabled": True})
    assert third.json()["domains"] == {"event": False}


def test_patch_merges_instead_of_replacing_the_map(client: Any, home_a: Actor) -> None:
    """نقشهٔ ارسالی با نقشهٔ ذخیره‌شده ادغام می‌شود، جایش را نمی‌گیرد.

    وگرنه UI مجبور بود هر بار **همهٔ** کلیدها را بفرستد، و فراموش‌کردنِ یکی
    بی‌صدا به پیش‌فرض برمی‌گشت."""
    client.patch(PREFS, headers=home_a.h, json={"domains": {"event": False}})
    res = client.patch(PREFS, headers=home_a.h, json={"domains": {"recurring": False}})
    assert res.status_code == 200, res.text
    assert res.json()["domains"] == {"event": False, "recurring": False}


# ═══════════════════════════════════════════════════════════════════
#  اعتبارسنجی — ورودیِ خراب نباید در JSONB بنشیند
# ═══════════════════════════════════════════════════════════════════
def test_unknown_domain_is_rejected(client: Any, home_a: Actor) -> None:
    """فهرستِ دامنه‌ها بسته است. بی این گارد، یک کلاینتِ خراب می‌توانست
    JSONB را با کلیدهای بی‌معنی پر کند و هیچ‌وقت کسی نمی‌فهمید."""
    for body in (
        {"domains": {"chores": True}},
        {"lead_days": {"vehicles": 3}},
    ):
        res = client.patch(PREFS, headers=home_a.h, json=body)
        assert res.status_code == 422, f"دامنهٔ ناشناس پذیرفته شد: {body} → {res.text}"

    # و هیچ‌کدام ذخیره نشده باشد.
    after = client.get(PREFS, headers=home_a.h)
    assert after.json()["domains"] == {}
    assert after.json()["lead_days"] == {}


def test_lead_days_are_clamped_not_trusted(client: Any, home_a: Actor) -> None:
    """منفی → صفر، بزرگ‌تر از سقف → سقف. این‌جا ۴۲۲ نمی‌دهیم چون عددِ بیرونِ
    بازه «ورودیِ بدخواه» نیست، فقط نامعقول است؛ ولی ذخیره‌شدنش یعنی فهرستِ
    اعلان بعداً از کنترل خارج می‌شود."""
    res = client.patch(PREFS, headers=home_a.h, json={"lead_days": {"event": -5}})
    assert res.status_code == 200, res.text
    assert res.json()["lead_days"]["event"] == 0

    res = client.patch(PREFS, headers=home_a.h, json={"lead_days": {"event": 9999}})
    assert res.status_code == 200, res.text
    assert res.json()["lead_days"]["event"] == 60, "سقفِ MAX_LEAD_DAYS اعمال نشد"


def test_boolean_is_not_accepted_as_lead_days(client: Any, home_a: Actor) -> None:
    """در پایتون `True` یک `int` است.

    اگر اسکیما `dict[str, int]` بود، سرنوشتِ این درخواست به رفتارِ نسخهٔ
    pydantic گره می‌خورد (یکی رد می‌کند، دیگری به `1` تبدیل می‌کند). پس فیلد
    عمداً `Any` است و تصمیم در `_clean_lead` گرفته می‌شود. این تست همان
    قطعی‌بودن را قفل می‌کند: `true` هرگز نباید «یک روز» بشود."""
    res = client.patch(PREFS, headers=home_a.h, json={"lead_days": {"event": True}})
    assert res.status_code == 422, res.text
    assert client.get(PREFS, headers=home_a.h).json()["lead_days"] == {}


def test_non_numeric_lead_days_are_rejected(client: Any, home_a: Actor) -> None:
    """رشته و None و کسری هم باید رد شوند، نه اینکه بی‌صدا به صفر بیفتند —
    صفر یعنی «همان روز» که یک تنظیمِ معتبر است، پس سکوت این‌جا تنظیمِ کاربر
    را جعل می‌کرد."""
    for bad in ("7", None, [], {}):
        res = client.patch(PREFS, headers=home_a.h, json={"lead_days": {"event": bad}})
        assert res.status_code == 422, f"مقدارِ {bad!r} پذیرفته شد: {res.text}"
    assert client.get(PREFS, headers=home_a.h).json()["lead_days"] == {}


def test_dismissal_key_must_be_sane(client: Any, home_a: Actor) -> None:
    assert_denied(client.post(DISMISS, headers=home_a.h, json={"key": ""}), "کلیدِ خالی")
    assert_denied(
        client.post(DISMISS, headers=home_a.h, json={"key": "   "}), "کلیدِ فقط‌فاصله"
    )
    assert_denied(
        client.post(DISMISS, headers=home_a.h, json={"key": "e" * 201}), "کلیدِ بیش از سقف"
    )
    assert keys(client.get(PREFS, headers=home_a.h)) == set()


# ═══════════════════════════════════════════════════════════════════
#  نادیده‌گرفتن — تکرارپذیر و برگشت‌پذیر
# ═══════════════════════════════════════════════════════════════════
KEY = "event:11111111-1111-4111-8111-111111111111:2026-11-03"


def test_dismiss_is_idempotent(client: Any, home_a: Actor) -> None:
    """دو لمسِ سریعِ همان دکمه نباید به نقضِ قیدِ یکتایی برسد."""
    for _ in range(3):
        res = client.post(DISMISS, headers=home_a.h, json={"key": KEY})
        assert res.status_code == 204, res.text
    assert keys(client.get(PREFS, headers=home_a.h)) == {KEY}


def test_undismiss_removes_and_is_safe_when_absent(client: Any, home_a: Actor) -> None:
    client.post(DISMISS, headers=home_a.h, json={"key": KEY})
    gone = client.delete(f"{DISMISS}/{KEY}", headers=home_a.h)
    assert gone.status_code == 204, gone.text
    assert keys(client.get(PREFS, headers=home_a.h)) == set()

    # دوباره‌زدن روی چیزی که نیست هم باید بی‌خطر باشد.
    again = client.delete(f"{DISMISS}/{KEY}", headers=home_a.h)
    assert again.status_code == 204, again.text


def test_dismissal_key_with_colons_survives_the_path(client: Any, home_a: Actor) -> None:
    """شناسهٔ اعلان خودش «:» دارد (`event:<uuid>:<date>`) و مسیرِ سرور
    `{key:path}` است. اگر روزی کسی `:path` را برداشت، این تست می‌شکند —
    وگرنه حذف بی‌صدا هیچ‌کاری نمی‌کرد و کاربر فکر می‌کرد برگشت."""
    client.post(DISMISS, headers=home_a.h, json={"key": KEY})
    assert KEY.count(":") == 2
    res = client.delete(f"{DISMISS}/{KEY}", headers=home_a.h)
    assert res.status_code == 204, res.text
    assert keys(client.get(PREFS, headers=home_a.h)) == set()


# ═══════════════════════════════════════════════════════════════════
#  مرز — per-member و per-family
# ═══════════════════════════════════════════════════════════════════
def test_prefs_are_per_member_not_per_family(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """ترجیح ستونِ `members` است، پس تغییرِ مدیر نباید عضو را هم عوض کند.
    اگر روزی اشتباهاً روی `families` می‌نشست، این تست می‌گیردش."""
    client.patch(PREFS, headers=home_a.h, json={"enabled": False})

    mine = client.get(PREFS, headers=member_a.h)
    assert mine.status_code == 200, mine.text
    assert mine.json()["enabled"] is True, "ترجیحِ مدیر روی عضوِ دیگر هم اعمال شد"

    owner = client.get(PREFS, headers=home_a.h)
    assert owner.json()["enabled"] is False


def test_dismissal_is_per_member_within_the_same_family(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """کلیدِ یکتا (member_id, key) است نه (family_id, key): نادیده‌گرفتنِ
    یادآورِ تولد توسطِ یک عضو نباید آن را برای بقیهٔ خانواده خفه کند."""
    res = client.post(DISMISS, headers=home_a.h, json={"key": KEY})
    assert res.status_code == 204, res.text

    assert keys(client.get(PREFS, headers=home_a.h)) == {KEY}
    assert keys(client.get(PREFS, headers=member_a.h)) == set(), (
        "نادیده‌گرفتنِ مدیر برای عضوِ دیگرِ همان خانواده هم اعمال شد"
    )


def test_dismissal_never_crosses_households(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """این جدول زیرِ RLS است و مسیرش `get_tenant_member` می‌گیرد. اگر کسی
    وابستگی را به `get_current_member` عوض کند، GUCِ `app.family_id` بسته
    نمی‌شود و محمولِ fail-closed درج را رد می‌کند — یا بدتر، اگر محمول هم
    برداشته شود، این تست نشتی را می‌گیرد."""
    assert client.post(DISMISS, headers=home_a.h, json={"key": KEY}).status_code == 204
    assert client.post(DISMISS, headers=home_b.h, json={"key": KEY}).status_code == 204

    # همان کلید در دو خانواده — هر کدام فقط مالِ خودش را می‌بیند.
    assert keys(client.get(PREFS, headers=home_a.h)) == {KEY}
    assert keys(client.get(PREFS, headers=home_b.h)) == {KEY}

    # و حذفِ الف نباید ردیفِ ب را ببرد.
    assert client.delete(f"{DISMISS}/{KEY}", headers=home_a.h).status_code == 204
    assert keys(client.get(PREFS, headers=home_a.h)) == set()
    assert keys(client.get(PREFS, headers=home_b.h)) == {KEY}, (
        "حذفِ خانوادهٔ الف ردیفِ خانوادهٔ ب را هم پاک کرد — مرزِ RLS باز است"
    )


def test_member_can_manage_own_notification_settings(
    client: Any, home_a: Actor
) -> None:
    """§۷ محدودِ مدیر نیست: هر عضو اعلان‌های خودش را تنظیم می‌کند.
    (گاردِ نقش جای دیگری است — در خودِ مشتق‌سازی، که درخواستِ عضویت را فقط
    به مدیر نشان می‌دهد.)"""
    member = add_active_member(client, home_a, "عضو تنظیم‌کننده")
    res = client.patch(PREFS, headers=member.h, json={"domains": {"recurring": False}})
    assert res.status_code == 200, res.text
    assert res.json()["domains"] == {"recurring": False}

    ok = client.post(DISMISS, headers=member.h, json={"key": KEY})
    assert ok.status_code == 204, ok.text
