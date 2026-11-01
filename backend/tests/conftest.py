"""زیرساخت مشترک تست‌های بک‌اند — دیتابیس ایزوله، کلاینت، و خانوادهٔ آماده.

چرا پستگرس واقعی و نه SQLite؟ مرز امنیتی این برنامه فقط کد نیست؛ ایزولهٔ خانواده
در خودِ دیتابیس با RLS اجرا می‌شود (مهاجرت 0002/0004/0005). SQLite نه RLS دارد نه
`set_config`، پس تست روی آن همه‌چیز را «سبز» نشان می‌دهد در حالی که هیچ‌چیز از
مرزِ واقعی تست نشده. این بدتر از نداشتن تست است.

⚠️ این تست‌ها جدول‌ها را TRUNCATE می‌کنند. برای همین سه قفلِ ایمنی دارند و اگر
هر کدام باز نشود، مجموعه اصلاً شروع نمی‌شود:
  ۱. نام دیتابیس تست باید با دیتابیس برنامه فرق داشته باشد.
  ۲. نام دیتابیس تست باید به `_test` ختم شود.
  ۳. APP_ENV نباید production باشد.

نشانی اتصال (که رمز داخلش است) هیچ‌جا چاپ نمی‌شود — در پیام‌های خطا فقط «نام
دیتابیس» می‌آید.

ترتیب import در این فایل عمدی است: `app/db/session.py` موتور SQLAlchemy را در
لحظهٔ import از `settings` می‌سازد. پس اول تنظیمات را به دیتابیس تست می‌چرخانیم و
تنها بعد از آن اجازه می‌دهیم لایهٔ دیتابیس/اپ import شود (import‌ها داخل فیکسچرها).
"""

from __future__ import annotations

import itertools
import os
import sys
import tempfile
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# تنها import مجاز پیش از چرخاندن تنظیمات: خودِ ماژول تنظیمات (به دیتابیس وصل نمی‌شود).
from app.core.config import Settings, get_settings, settings  # noqa: E402


# ═══════════════════════════════════════════════════════════════════
#  ۱) نشانی دیتابیس تست + قفل‌های ایمنی
# ═══════════════════════════════════════════════════════════════════
def _resolve_test_url() -> URL:
    """نشانی دیتابیس تست را می‌سازد و سه قفل ایمنی را می‌سنجد."""
    app_url = make_url(settings.database_url)
    explicit = os.environ.get("TEST_DATABASE_URL", "").strip()
    url = make_url(explicit) if explicit else app_url.set(database=f"{app_url.database}_test")

    app_db = app_url.database or ""
    test_db = url.database or ""

    if not test_db:
        raise RuntimeError("نام دیتابیس تست خالی است؛ TEST_DATABASE_URL را درست بده.")
    if test_db == app_db:
        raise RuntimeError(
            f"دیتابیس تست و دیتابیس برنامه یکی‌اند ({test_db}). "
            "این تست‌ها TRUNCATE می‌کنند؛ اجرا متوقف شد."
        )
    if not test_db.endswith("_test"):
        raise RuntimeError(
            f"نام دیتابیس تست باید به «_test» ختم شود (الان: {test_db}) — قفل ایمنی TRUNCATE."
        )
    if settings.is_production:
        raise RuntimeError("APP_ENV روی production است؛ تست‌ها اجرا نمی‌شوند.")
    return url


TEST_URL = _resolve_test_url()
TEST_DB_NAME = TEST_URL.database or ""

# چرخاندن تنظیمات به دیتابیس تست — «پیش از» import شدن app.db.session.
_rendered = TEST_URL.render_as_string(hide_password=False)
settings.database_url = _rendered
os.environ["DATABASE_URL"] = _rendered
get_settings.cache_clear()

# رازهای لازم برای مسیرهایی که تست می‌شوند (فقط مقدار تستی، نه راز واقعی).
os.environ.setdefault("FILE_SIGNING_SECRET", "test-only-signing-secret")
settings.file_signing_secret = settings.file_signing_secret or "test-only-signing-secret"

# ذخیره‌سازی: تست‌ها نباید نه به فضای ابری دست بزنند و نه چیزی در مخزن جا بگذارند.
#
# `app/services/storage.py` در «لحظهٔ import» تصمیم می‌گیرد: اگر endpoint و bucket
# ست باشند S3 را برمی‌دارد (یعنی تست به شبکه وصل می‌شود)، وگرنه دیسک را با
# مقدارِ آن‌لحظهٔ storage_dir. هر دو انتخاب همین‌جا — پیش از اولین import — قفل
# می‌شوند: S3 خاموش، و ریشهٔ دیسک یک پوشهٔ موقت به‌جای `backend/var/uploads`.
settings.storage_endpoint = ""
settings.storage_bucket = ""
settings.storage_dir = tempfile.mkdtemp(prefix="khaneyar-test-uploads-")
os.environ["STORAGE_DIR"] = settings.storage_dir

# سقفِ نرخِ per-IP: پیش‌فرضِ کلِ مجموعه «بی‌سقف» است — و این یک انتخابِ آگاهانه است.
#
# چرا؟ کلیدِ سطل نشانیِ کلاینت است، و `TestClient` نشانیِ واقعی ندارد
# (`request.client.host == "testclient"` که IP معتبر نیست) پس همهٔ تست‌ها در یک
# سطلِ مشترک می‌افتند. مجموعه در هر اجرا ده‌ها خانواده می‌سازد و ده‌ها بار وارد
# می‌شود، همه در یک پنجرهٔ ۶۰ ثانیه‌ای؛ با سقف‌های واقعی، تست‌ها یکی‌یکی ۴۲۹
# می‌گرفتند و شکستِ حاصل هیچ ربطی به چیزی که می‌سنجند نداشت.
#
# پس سقف‌ها را تست‌های **اختصاصیِ** خودشان با فیکسچرِ `rate_limit` روشن می‌کنند
# (تست‌های `test_rate_limit.py`)، نه به‌صورتِ سراسری.
_RL_FIELDS = tuple(f for f in Settings.model_fields if f.startswith("rl_") and f != "rl_window_seconds")
for _field in _RL_FIELDS:
    setattr(settings, _field, 0)  # صفر = بی‌سقف (قرارداد سرویسِ ratelimit)
# نمکِ ثابت تا شمارنده بینِ ری‌استارت‌های درون‌فرایندی پایدار بماند.
settings.rate_limit_salt = "test-only-rate-limit-salt"


# ═══════════════════════════════════════════════════════════════════
#  ۲) ساخت دیتابیس + مهاجرت‌ها (یک‌بار در هر اجرا)
# ═══════════════════════════════════════════════════════════════════
@pytest.fixture(scope="session")
def database() -> Iterator[None]:
    """دیتابیس تست را می‌سازد (اگر نبود) و تا `head` مهاجرت می‌دهد."""
    admin = create_engine(
        TEST_URL.set(database="postgres"),
        isolation_level="AUTOCOMMIT",
        future=True,
    )
    try:
        with admin.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": TEST_DB_NAME}
            ).first()
            if exists is None:
                # نام از make_url آمده، نه از ورودی کاربر؛ نقل‌قول دوتایی کافی است.
                conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    finally:
        admin.dispose()

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_tables(database: None) -> Iterator[None]:
    """پیش از هر تست، همهٔ جدول‌های داده خالی می‌شوند (به‌جز alembic_version).

    TRUNCATE مشمول پالیسی‌های RLS نیست، پس نیازی به زمینهٔ خانواده ندارد.
    """
    from app.db.session import engine

    with engine.begin() as conn:
        names = (
            conn.execute(
                text(
                    "SELECT tablename FROM pg_tables "
                    "WHERE schemaname = 'public' AND tablename <> 'alembic_version' "
                    "ORDER BY tablename"
                )
            )
            .scalars()
            .all()
        )
        if names:
            joined = ", ".join(f'"{n}"' for n in names)
            conn.execute(text(f"TRUNCATE {joined} RESTART IDENTITY CASCADE"))
    yield


@pytest.fixture()
def client(clean_tables: None) -> Iterator[Any]:
    """کلاینت HTTP روی همان اپ واقعی FastAPI (با همهٔ وابستگی‌های اصلی)."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def raw_sql(clean_tables: None) -> Iterator[Any]:
    """اتصال خام برای سنجش‌های سطحِ دیتابیس (پالیسی‌ها، نقش، fail-closed)."""
    from app.db.session import engine

    with engine.connect() as conn:
        yield conn


@pytest.fixture()
def rate_limit() -> Iterator[Any]:
    """سقفِ نرخ را برای یک تست روشن می‌کند و در پایان به «بی‌سقف» برمی‌گرداند.

    استفاده:
        def test_x(client, rate_limit):
            rate_limit(login_per_ip=2)
            ...

    چرا فیکسچر و نه تنظیمِ مستقیم؟ چون فراموش‌کردنِ بازگرداندنِ مقدار، تست‌های
    بعدی را به‌شکلِ مرموزی ۴۲۹ می‌کند (همهٔ تست‌ها یک سطلِ مشترک دارند). این
    فیکسچر بازگردانی را تضمین می‌کند.
    """
    changed: dict[str, int] = {}

    def apply(**limits: int) -> None:
        for name, value in limits.items():
            field = name if name.startswith("rl_") else f"rl_{name}"
            if field not in Settings.model_fields:
                raise AssertionError(f"تنظیمِ سقفِ نرخ وجود ندارد: {field}")
            changed.setdefault(field, getattr(settings, field))
            setattr(settings, field, value)

    yield apply

    for field, previous in changed.items():
        setattr(settings, field, previous)


# ═══════════════════════════════════════════════════════════════════
#  ۳) سازندهٔ خانواده و عضو — فقط از راه API عمومی
# ═══════════════════════════════════════════════════════════════════
API = "/api/v1"
# روترِ احراز هویت پیشوندِ خودش را دارد (`APIRouter(prefix="/auth")`)، ولی روت‌های
# داده و «تنظیمات خانواده/نسبتِ عضو» ندارند. پس مسیرها دو خانوادهٔ جدا دارند:
#   AUTH → register / login / session / logout / family / members / invite
#   API  → transactions / accounts / … و همچنین family/settings و members/{id}/relation
# این ثابت عمداً جداست تا اشتباهِ «۴۰۴ به‌جای ۴۰۳» دوباره در تست‌ها تکرار نشود.
AUTH = f"{API}/auth"
PASSWORD = "Test-Passw0rd"

_phone_seq = itertools.count(1)


def next_phone() -> str:
    """شمارهٔ یکتا با قالبِ معتبرِ ایران (۰۹۱۲ + ۷ رقم)."""
    return f"0912{next(_phone_seq):07d}"


@dataclass(frozen=True)
class Actor:
    """یک کاربرِ احرازشده + خانواده‌اش + هدرِ آمادهٔ ارسال."""

    member_id: str
    family_id: str
    family_code: str
    phone: str
    role: str
    token: str

    @property
    def h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


def _actor_from_auth(payload: dict) -> Actor:
    return Actor(
        member_id=payload["member"]["id"],
        family_id=payload["member"]["family_id"],
        family_code=payload["family"]["code"],
        phone=payload["member"]["phone"],
        role=payload["member"]["role"],
        token=payload["session_token"],
    )


def create_household(client: Any, name: str = "خانوادهٔ آزمون", owner: str = "مدیر") -> Actor:
    """ثبت‌نام تازه → خانوادهٔ جدید + عضوِ اولِ با نقش owner."""
    res = client.post(
        f"{AUTH}/register",
        json={
            "family_name": name,
            "member_name": owner,
            "phone": next_phone(),
            "password": PASSWORD,
        },
    )
    assert res.status_code == 200, res.text
    return _actor_from_auth(res.json())


def create_invite_token(client: Any, owner: Actor) -> str:
    """مدیر یک لینکِ دعوتِ تازه می‌سازد و توکنش را برمی‌گرداند."""
    inv = client.post(f"{AUTH}/invite", headers=owner.h)
    assert inv.status_code == 200, inv.text
    return inv.json()["token"]


def accept_invite(
    client: Any, token: str, *, name: str, phone: str, relation: str = "فرزند"
) -> Any:
    """پذیرشِ لینک → یک join_requestِ «pending» می‌سازد و **نشست نمی‌دهد** (§2.6).

    پاسخِ خام برگردانده می‌شود (نه Actor) چون این مرحله عضو را فعال نمی‌کند؛
    خروجی JoinPendingResult است: {family_name, state='pending'}.
    """
    return client.post(
        f"{AUTH}/accept-invite",
        json={
            "invite_token": token,
            "member_name": name,
            "phone": phone,
            "password": PASSWORD,
            "relation": relation,
        },
    )


def login_as(client: Any, phone: str, password: str = PASSWORD) -> Actor:
    """ورودِ یک عضوِ فعال → Actorِ احرازشده (توکن از پاسخِ login؛ OTP در تست خاموش است)."""
    res = client.post(f"{AUTH}/login", json={"phone": phone, "password": password})
    assert res.status_code == 200, res.text
    return _actor_from_auth(res.json())


def approve_join_request(client: Any, owner: Actor, member_phone: str) -> dict:
    """مدیر: درخواستِ pendingِ این شماره را در فهرست پیدا و تأیید می‌کند.

    فهرست زیرِ RLS خانواده خوانده می‌شود (require_admin_tenant)؛ پس فقط درخواست‌های
    همین خانواده دیده می‌شوند و تطبیق با «شماره» امن است.
    """
    reqs = client.get(f"{AUTH}/join-requests", headers=owner.h)
    assert reqs.status_code == 200, reqs.text
    match = next((r for r in reqs.json() if r["phone"] == member_phone), None)
    assert match is not None, f"درخواستِ پیوستنِ {member_phone} در فهرست نبود: {reqs.text}"
    ok = client.post(f"{AUTH}/join-requests/{match['id']}/approve", headers=owner.h)
    assert ok.status_code == 200, ok.text
    return ok.json()


def add_active_member(client: Any, owner: Actor, name: str = "عضو") -> Actor:
    """عضو دومِ «فعال» در همان خانواده — مسیرِ کاملِ محصول پس از مرحلهٔ B (§2.6):
    دعوت → پذیرش (pending، بی‌نشست) → تأییدِ مدیر → ورود (نشست).

    امضای بیرونی همان است (Actorِ فعال برمی‌گرداند)، پس آزمون‌هایی که «عضوِ فعال»
    می‌خواهند بی‌تغییر می‌مانند؛ ولی درون، جریانِ تأیید-محور را طی می‌کند تا زیرساختِ
    تست با قراردادِ تازهٔ accept-invite (که دیگر نشست نمی‌دهد) هم‌خوان بماند.
    """
    token = create_invite_token(client, owner)
    phone = next_phone()
    res = accept_invite(client, token, name=name, phone=phone)
    assert res.status_code == 200, res.text
    assert res.json().get("state") == "pending", res.text
    approve_join_request(client, owner, phone)
    return login_as(client, phone)


# ── فیکسچرهای پرکاربرد ───────────────────────────────────────────
@pytest.fixture()
def home_a(client: Any) -> Actor:
    return create_household(client, "خانوادهٔ الف", "مدیر الف")


@pytest.fixture()
def home_b(client: Any) -> Actor:
    return create_household(client, "خانوادهٔ ب", "مدیر ب")


@pytest.fixture()
def member_a(client: Any, home_a: Actor) -> Actor:
    return add_active_member(client, home_a, "عضو الف")


# ═══════════════════════════════════════════════════════════════════
#  ۴) سازندهٔ منابعِ دامنه (همه با هدرِ صاحبِ واقعی‌شان)
# ═══════════════════════════════════════════════════════════════════
# دستهٔ تراکنش «شناسهٔ انگلیسی» است نه برچسبِ فارسی: سرور آن را با
# _FIXED_CATEGORIES در services/transactions.py می‌سنجد و «خوراک» را رد می‌کند.
# ترجمه‌اش کارِ فرانت است. اینجا عمداً همان شناسه را می‌فرستیم.
CATEGORY = "food"

_card_seq = itertools.count(1)


def next_card() -> str:
    """شمارهٔ کارتِ ۱۶ رقمیِ یکتا. ۶ رقمِ اولش عمداً در جدولِ BIN نیست تا
    اعتبارسنجیِ «کارت با بانک هم‌خوان نیست» وسطِ تستِ امنیت سبز نشود."""
    return f"999900{next(_card_seq):010d}"


# ── assertِ کدِ موفقیتِ مسیرهای نوشتن ─────────────────────────────────────────
# مهارِ ویژهٔ شکافِ #۶ (تبدیلِ ۵۰۰→xfail) در مرحلهٔ B برداشته شد: مسیرِ نوشتن حالا
# زمینهٔ خانواده را پس از commit نگه می‌دارد (deps.bind_family_to_session روی
# Session.info، پایدار پس از commit) و ۲۰۱/۲۰۰ می‌دهد. پس ۵۰۰ دوباره «شکستِ سخت»
# است تا باگ‌های واقعیِ مسیرِ نوشتن پنهان نشوند. اثباتِ رفع:
# test_known_gaps.test_write_path_keeps_rls_context_after_commit.
def expect_status(res: Any, *ok_codes: int) -> Any:
    """assertِ اینکه پاسخ یکی از کدهای موفقیتِ موردانتظار است (وگرنه شکستِ سخت)."""
    assert res.status_code in ok_codes, res.text
    return res


def make_account(client: Any, who: Actor, title: str = "حساب", kind: str = "bank") -> str:
    body: dict[str, Any] = {"member_id": who.member_id, "title": title, "kind": kind}
    if kind == "bank":
        # حسابِ بانکی بدون شماره کارت پذیرفته نمی‌شود (EMPTY_ACCOUNT/۴۲۲).
        body["card_number"] = next_card()
    res = client.post(f"{API}/accounts", headers=who.h, json=body)
    expect_status(res, 201)
    return res.json()["id"]


def make_transaction(client: Any, who: Actor, amount: str = "10000") -> str:
    res = client.post(
        f"{API}/transactions",
        headers=who.h,
        json={
            "member_id": who.member_id,
            "type": "expense",
            "amount": amount,
            "category": CATEGORY,
            "date": "2026-09-01",
        },
    )
    expect_status(res, 201)
    return res.json()["id"]


def make_event(client: Any, who: Actor, title: str = "تولد") -> str:
    res = client.post(
        f"{API}/events",
        headers=who.h,
        json={"title": title, "date": "2026-10-01", "member_id": who.member_id},
    )
    expect_status(res, 201)
    return res.json()["id"]


def make_holding(client: Any, who: Actor) -> str:
    """دارایی می‌سازد. عمداً هیچ‌جا GET /holdings صدا نمی‌زنیم: آن مسیر برای
    ارزش‌گذاری به سرویس بازار (BrsApi) وصل است و تست نباید به شبکه تکیه کند."""
    res = client.post(
        f"{API}/holdings",
        headers=who.h,
        json={
            "kind": "gold",
            "symbol": "IR_GOLD_18K",
            "name": "طلای ۱۸ عیار",
            "unit": "gram",
            "quantity": "2",
        },
    )
    expect_status(res, 201)
    return res.json()["id"]


def make_category_budget(client: Any, owner: Actor, category: str = CATEGORY) -> str:
    """سقف بودجهٔ دسته — فقط مدیر مجاز است (پس همیشه با هدرِ مدیر صدا بزن)."""
    res = client.post(
        f"{API}/category-budgets",
        headers=owner.h,
        json={"category": category, "amount": "500000"},
    )
    expect_status(res, 200)
    return res.json()["id"]


def make_subcategory(client: Any, who: Actor, name: str = "نان") -> str:
    res = client.post(
        f"{API}/subcategories",
        headers=who.h,
        json={"category": CATEGORY, "name": name},
    )
    expect_status(res, 201)
    return res.json()["id"]


def make_custom_category(client: Any, who: Actor, name: str = "باشگاه") -> str:
    res = client.post(
        f"{API}/custom-categories",
        headers=who.h,
        json={"type": "expense", "name": name},
    )
    expect_status(res, 201)
    return res.json()["id"]
