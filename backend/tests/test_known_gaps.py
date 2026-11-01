"""§۵.۵/§۲.۶/§۲.۸ + عدم‌تقارنِ tx — «شکاف‌های شناخته‌شده» را به تستِ زنده تبدیل می‌کند.

این فایل با بقیهٔ مجموعه فرق دارد. تست‌های دیگر رفتارِ «درستِ امروز» را قفل می‌کنند
تا نشکند. این‌ها برعکس‌اند: رفتارِ «درستی که هنوز نداریم» را می‌نویسند و با
`xfail(strict=False)` علامت می‌زنند.

چرا این‌طوری؟

  • هر assert همان چیزی است که *باید* درست باشد (مثلاً «فایل بدونِ عضویت سرو نشود»).
  • امروز آن رفتار وجود ندارد، پس تست می‌شکند — ولی xfail آن را به شکستِ مجموعه
    تبدیل نمی‌کند؛ فقط به‌عنوان «شکافِ ثبت‌شده» گزارش می‌دهد (xfailed).
  • روزی که کسی شکاف را ببندد، تست سبز می‌شود و چون strict=False است، همان لحظه
    «xpassed» گزارش می‌شود — یک یادآوریِ خودکار که «این را از فهرست شکاف‌ها دربیاور».

پس این فایل هم مستندِ زندهٔ بدهیِ فنی است و هم تستِ پذیرشِ رفعش.

به‌روزرسانیِ مرحلهٔ B (۲۰۲۶-۰۹-۲۲): سه شکاف رفع شدند و آزمون‌هایشان از xfail به
«قفلِ رگرسیون» ارتقا یافتند (دیگر بدهی نیستند، بلکه نگهبانِ ماندگاریِ اصلاح‌اند):
  • #۲ §۲.۶ — پیوستن حالا منتظرِ تأییدِ مدیر می‌ماند (accept-invite نشست نمی‌دهد).
  • #۳ §۲.۶(ب) — لینکِ دعوت تک‌مصرفه شد (پس از اولین پذیرش سوزانده می‌شود).
  • #۶ — زمینهٔ RLS پس از commit در مسیرِ نوشتن حفظ می‌شود.
شکاف‌های #۱ (§۵.۵ فایل)، #۴ (§۲.۸ ممیزی) و #۵ (عدم‌تقارنِ PATCH تراکنش) هنوز بازند
و xfail می‌مانند (خارج از دامنهٔ مرحلهٔ B).

ارجاع کامل در docs/audit-2026-09-17-master-prompt.md.
"""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import (
    API,
    AUTH,
    CATEGORY,
    PASSWORD,
    Actor,
    accept_invite,
    approve_join_request,
    create_invite_token,
    login_as,
    make_transaction,
    next_phone,
)

# کوچک‌ترین PNGِ معتبر (۱×۱). regexِ storage فقط png/jpeg/webp و base64 خالص می‌پذیرد.
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC"
)


def _upload_photo_url(client: Any, who: Actor) -> str:
    """یک عکس آپلود می‌کند و URLِ امضاشدهٔ HMAC را برمی‌گرداند (نسبی، هم‌مبدأ)."""
    res = client.post(f"{API}/uploads/photo", headers=who.h, json={"image": TINY_PNG})
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert "/api/v1/files/" in url and "sig=" in url, url
    return url


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۱ — §۵.۵: URLِ امضاشدهٔ فایل عضویت را نمی‌سنجد
# ═══════════════════════════════════════════════════════════════════
@pytest.mark.xfail(
    reason="§۵.۵ شکافِ ثبت‌شده: GET /files/{path}?sig= عمداً بی‌احراز است و امضا یک "
    "«قابلیتِ حامل» است؛ هر کس URL را داشته باشد بایت‌ها را می‌گیرد. مرزِ عضویتِ "
    "خانواده روی فایل‌ها بررسی نمی‌شود.",
    strict=False,
)
def test_signed_file_url_should_require_household_membership(
    client: Any, home_a: Actor, home_b: Actor
) -> None:
    """رفتارِ مطلوب: فایلِ خانوادهٔ الف نباید با درخواستِ بی‌احراز/خانوادهٔ ب سرو شود."""
    url = _upload_photo_url(client, home_a)

    # درخواستِ کاملاً بی‌احراز — امروز چون امضا معتبر است، ۲۰۰ می‌گیرد.
    anon = client.get(url)
    assert anon.status_code != 200, "فایل بدونِ هیچ احراز هویتی سرو شد (فقط با داشتنِ URL)."

    # عضوِ خانوادهٔ ب هم نباید فایلِ خانوادهٔ الف را بگیرد.
    other = client.get(url, headers=home_b.h)
    assert other.status_code in {401, 403, 404}, "عضوِ خانوادهٔ دیگر فایل را گرفت."


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۲ — §۲.۶: پذیرشِ دعوت باید منتظرِ تأییدِ مدیر بماند  ✅ رفع‌شده در مرحلهٔ B
# ═══════════════════════════════════════════════════════════════════
def test_accepted_invite_should_wait_for_admin_approval(client: Any, home_a: Actor) -> None:
    """رفتارِ درست (اکنون برقرار): عضوِ تازه‌پذیرفته تا تأییدِ مدیر نه نشست می‌گیرد و
    نه به دادهٔ خانواده می‌رسد؛ پس از تأیید، ورود و دسترسی باز می‌شود (§2.6)."""
    token = create_invite_token(client, home_a)
    phone = next_phone()

    # پذیرشِ دعوت دیگر نشست نمی‌دهد؛ فقط درخواستِ pending می‌سازد.
    accepted = accept_invite(client, token, name="تازه‌وارد", phone=phone)
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["state"] == "pending", accepted.text
    assert "session_token" not in accepted.json(), "پذیرشِ دعوت نباید نشست بدهد."

    # ۱) پیش از تأیید: ورود ممنوع است (MEMBERSHIP_PENDING/۴۰۳) — پس اصلاً توکنی نیست.
    denied = client.post(f"{AUTH}/login", json={"phone": phone, "password": PASSWORD})
    assert denied.status_code == 403, denied.text
    assert denied.json()["error"] == "MEMBERSHIP_PENDING", denied.text

    # ۲) مدیر تأیید می‌کند → عضویت ACTIVE می‌شود (نقش هنوز عضوِ عادی است).
    approved = approve_join_request(client, home_a, phone)
    assert approved["role"] == "member"

    # ۳) پس از تأیید: ورود ممکن و دادهٔ خانواده در دسترس است.
    newcomer = login_as(client, phone)
    res = client.get(f"{API}/transactions", headers=newcomer.h)
    assert res.status_code == 200, res.text


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۳ — §۲.۶(ب): توکنِ دعوت باید یک‌بارمصرف باشد  ✅ رفع‌شده در مرحلهٔ B
# ═══════════════════════════════════════════════════════════════════
def test_invite_token_should_be_single_use(client: Any, home_a: Actor) -> None:
    """رفتارِ درست (اکنون برقرار): توکنِ دعوت پس از اولین پذیرش می‌سوزد.

    این خطرناک‌ترین حالتِ شکافِ دعوت بود: لینک معمولاً از راهِ پیام‌رسان می‌رود و
    در تاریخچهٔ گفت‌وگو می‌ماند. حالا پس از اولین پذیرش inv.active=False می‌شود، پس
    پذیرشِ دومِ همان توکن دیگر کار نمی‌کند (INVALID_INVITE/۴۰۴)."""
    inv = client.post(f"{AUTH}/invite", headers=home_a.h)
    assert inv.status_code == 200, inv.text
    token = inv.json()["token"]

    def _accept(name: str) -> Any:
        return client.post(
            f"{AUTH}/accept-invite",
            json={
                "invite_token": token,
                "member_name": name,
                "phone": next_phone(),
                "password": PASSWORD,
                "relation": "فرزند",
            },
        )

    first = _accept("نفرِ اول")
    assert first.status_code == 200, first.text  # شاهدِ مثبت: توکن واقعاً معتبر بود

    second = _accept("نفرِ دوم")
    assert second.status_code != 200, (
        "همان توکنِ دعوت بارِ دوم هم پذیرفته شد — لینکِ دعوت یک‌بارمصرف نیست."
    )


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۴ — §۲.۸: جدولِ ممیزی (audit log) وجود ندارد
# ═══════════════════════════════════════════════════════════════════
@pytest.mark.xfail(
    reason="§۲.۸ شکافِ ثبت‌شده: هیچ جدولِ ممیزی‌ای در اسکیما نیست؛ عملیاتِ حساس "
    "(ورود، تغییرِ نقش، حذفِ عضو، تغییرِ بودجه) ردِّ پایدار نمی‌گذارند.",
    strict=False,
)
def test_an_audit_trail_table_should_exist(raw_sql: Any) -> None:
    """رفتارِ مطلوب: دستِ‌کم یک جدول برای ثبتِ رویدادهای حساس باشد."""
    rows = (
        raw_sql.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' "
                "AND (table_name LIKE '%audit%' OR table_name LIKE '%activity%' "
                "OR table_name LIKE '%event_log%')"
            )
        )
        .scalars()
        .all()
    )
    assert rows, "هیچ جدولِ ممیزی/فعالیتی پیدا نشد."


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۵ — عدم‌تقارن: PATCH تراکنش مهارِ per-member ندارد، DELETE دارد
# ═══════════════════════════════════════════════════════════════════
@pytest.mark.xfail(
    reason="شکافِ ثبت‌شده: transactions.update فقط با family_id فیلتر می‌کند، پس عضوِ "
    "عادی می‌تواند تراکنشِ عضوِ دیگر (از جمله مدیر) را ویرایش کند — در حالی که "
    "transactions.delete مهارِ member_id دارد. عدم‌تقارن، نه نشتِ خانواده.",
    strict=False,
)
def test_member_should_not_edit_another_members_transaction(
    client: Any, home_a: Actor, member_a: Actor
) -> None:
    """رفتارِ مطلوب: PATCH هم مثل DELETE برای غیرمالک فقط روی ردیفِ خودش کار کند."""
    owner_tx = make_transaction(client, home_a, "40000")

    res = client.patch(
        f"{API}/transactions/{owner_tx}",
        headers=member_a.h,
        json={
            "member_id": member_a.member_id,
            "type": "expense",
            "amount": "1",
            "category": CATEGORY,
            "date": "2026-09-02",
        },
    )
    assert res.status_code in {403, 404}, (
        "عضوِ عادی تراکنشِ مدیر را ویرایش کرد (PATCH مهارِ per-member ندارد)."
    )

    # اثباتِ اینکه شکاف واقعی است، نه اشتباهِ مسیر: همان کار روی تراکنشِ خودش کار می‌کند.
    own_tx = make_transaction(client, member_a, "30000")
    ok = client.patch(
        f"{API}/transactions/{own_tx}",
        headers=member_a.h,
        json={
            "member_id": member_a.member_id,
            "type": "expense",
            "amount": "2",
            "category": CATEGORY,
            "date": "2026-09-02",
        },
    )
    assert ok.status_code == 204, ok.text


# ═══════════════════════════════════════════════════════════════════
#  شکاف ۶ — زمینهٔ RLS پس از commit در مسیرِ نوشتن  ✅ رفع‌شده در مرحلهٔ B
#  (اولین اجرای واقعی روی پستگرس، ۲۰۲۶-۰۹-۲۱؛ رفع، ۲۰۲۶-۰۹-۲۲)
# ═══════════════════════════════════════════════════════════════════
def test_write_path_keeps_rls_context_after_commit(client: Any, home_a: Actor) -> None:
    """رفتارِ درست (اکنون برقرار): ساختِ یک منبع از راهِ اندپوینتِ واقعیِ نوشتن ۲۰۱ می‌دهد.

    رفعِ مرحلهٔ B زمینهٔ خانواده را روی Session.info می‌گذارد (پایدار پس از commit، مستقل
    از threadpool)، پس دوباره‌خوانیِ ردیف پس از commit زیرِ نقشِ واقعیِ RLS دیگر صفر
    ردیف نمی‌بیند. (کیف‌پول انتخاب شده تا شماره‌کارت لازم نباشد و تنها متغیرِ آزمون،
    همان دوباره‌خوانیِ پس از commit بماند.)"""
    res = client.post(
        f"{API}/accounts",
        headers=home_a.h,
        json={"member_id": home_a.member_id, "title": "حسابِ سنجهٔ زمینه", "kind": "wallet"},
    )
    assert res.status_code == 201, (
        "ساختِ حساب زیرِ نقشِ واقعیِ RLS ۲۰۱ نداد — زمینهٔ خانواده پس از commit گم شد "
        f"(کد {res.status_code}: {res.text[:200]})."
    )
    # شاهدِ مثبت: ردیفِ تازه بلافاصله برای همان خانواده خواندنی است.
    listed = client.get(f"{API}/accounts", headers=home_a.h)
    assert listed.status_code == 200, listed.text
    assert res.json()["id"] in {a["id"] for a in listed.json()}

