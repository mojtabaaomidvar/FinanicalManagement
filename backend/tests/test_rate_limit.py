"""مرزِ سقفِ نرخِ per-IP روی مسیرهای عمومیِ احراز — رفعِ شکافِ #۱۵ (§5.11).

این پرونده چیزی را می‌سنجد که پیش از این هیچ تستی نداشت: محورِ **مبدأ**.
شمارندهٔ `auth_attempts` با «شماره» کلید می‌خورد، پس هر تستی که فقط آن را می‌سنجد
یک حفرهٔ کامل را نمی‌بیند — مهاجمی که یک رمزِ رایج را روی هزار شمارهٔ **مختلف**
می‌آزماید هیچ‌گاه به قفلِ per-phone نمی‌خورد.

همهٔ تست‌ها فیکسچرِ `rate_limit` را صدا می‌زنند چون سقف در کلِ مجموعه خاموش است
(دلیلش در `conftest.py` نوشته شده: کلاینتِ تست نشانیِ واقعی ندارد و همهٔ تست‌ها در
یک سطل می‌افتند).

⚠️ نکتهٔ خواندنِ این تست‌ها: چون `TestClient` هیچ نشانیِ معتبری ندارد، سطلِ همهٔ
درخواست‌ها یکی است (`"unknown"`). پس اینجا «per-IP بودن» را با جداییِ سطل‌ها
نمی‌سنجیم، بلکه می‌سنجیم که (الف) سقف وجود دارد و می‌بندد، (ب) سطلِ هر مسیر از
مسیرهای دیگر جداست، و (پ) شمارش با شمارهٔ متفاوت دور زده نمی‌شود — که دقیقاً همان
حفره‌ای است که وجود داشت. جداییِ خودِ سطل‌ها در `test_client_ip_resolution` روی
تابعِ `client_ip` سنجیده می‌شود.
"""

from __future__ import annotations

from typing import Any

from tests.conftest import AUTH, PASSWORD, create_household, next_phone


# ═══════════════════════════════════════════════════════════════════
#  ۱) اوراکلِ «شمارهٔ پیش‌ثبت‌شده» — حفرهٔ اصلیِ شکافِ #۱۵
# ═══════════════════════════════════════════════════════════════════
def test_pre_registered_blocks_after_limit(client: Any, rate_limit: Any) -> None:
    """پرسشِ پیاپیِ «آیا این شماره دعوت شده؟» پس از سقف ۴۲۹ می‌گیرد.

    پیش از رفع، این اندپوینت فقط سقفِ سراسریِ ۶۰/دقیقه داشت؛ یعنی یک اسکریپت
    می‌توانست ۶۰ شماره در دقیقه بشمارد و همان سقف را به سلاحِ DoS بدل کند.
    """
    rate_limit(pre_registered_per_ip=3)

    for _ in range(3):
        ok = client.post(f"{AUTH}/pre-registered", json={"phone": next_phone()})
        assert ok.status_code == 200, ok.text

    blocked = client.post(f"{AUTH}/pre-registered", json={"phone": next_phone()})
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["error"] == "TOO_MANY_ATTEMPTS"


def test_pre_registered_limit_is_not_bypassed_by_changing_phone(
    client: Any, rate_limit: Any
) -> None:
    """عوض‌کردنِ شماره سقف را دور نمی‌زند — کلیدِ سطل مبدأ است نه شماره.

    این همان تفاوتِ بنیادینِ `ratelimit` با `attempts` است؛ اگر روزی کسی کلیدِ سطل
    را به شماره برگرداند، همین تست می‌شکند.
    """
    rate_limit(pre_registered_per_ip=2)

    first = client.post(f"{AUTH}/pre-registered", json={"phone": "09120000001"})
    second = client.post(f"{AUTH}/pre-registered", json={"phone": "09120000002"})
    third = client.post(f"{AUTH}/pre-registered", json={"phone": "09120000003"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert third.status_code == 429


# ═══════════════════════════════════════════════════════════════════
#  ۲) ورود و بررسیِ رمز — محورِ credential stuffing
# ═══════════════════════════════════════════════════════════════════
def test_login_rate_limited_across_different_phones(client: Any, rate_limit: Any) -> None:
    """آزمودنِ یک رمز روی شماره‌های مختلف پس از سقفِ مبدأ بسته می‌شود.

    قفلِ per-phone (`auth_attempts`) اینجا هرگز فعال نمی‌شود چون هر درخواست شمارهٔ
    تازه‌ای دارد؛ تنها چیزی که جلویش را می‌گیرد سقفِ per-IP است.
    """
    rate_limit(login_per_ip=3)

    codes = [
        client.post(
            f"{AUTH}/login", json={"phone": next_phone(), "password": "wrong-password"}
        ).status_code
        for _ in range(4)
    ]

    assert codes[:3] == [401, 401, 401], codes
    assert codes[3] == 429, codes


def test_login_limit_precedes_password_hashing(client: Any, rate_limit: Any) -> None:
    """پس از سقف، حتی **رمزِ درست** هم ۴۲۹ می‌گیرد (نه ۲۰۰).

    اهمیتش: سقف باید *پیش از* هشِ Argon2id بیفتد، وگرنه خودِ ورود اهرمِ DoS است
    (هر تلاش ده‌ها میلی‌ثانیه CPU). اگر روزی کسی `ratelimit.hit` را به پایینِ
    تابعِ login جابه‌جا کند، این تست می‌شکند.
    """
    owner = create_household(client)
    rate_limit(login_per_ip=1)

    burned = client.post(
        f"{AUTH}/login", json={"phone": next_phone(), "password": "wrong-password"}
    )
    assert burned.status_code == 401, burned.text

    valid = client.post(f"{AUTH}/login", json={"phone": owner.phone, "password": PASSWORD})
    assert valid.status_code == 429, valid.text


def test_check_password_oracle_is_rate_limited(client: Any, rate_limit: Any) -> None:
    """اندپوینتِ `check-password` هم سقفِ مبدأ دارد (اوراکلِ «این رمز درست است؟»)."""
    rate_limit(check_password_per_ip=2)

    for _ in range(2):
        res = client.post(
            f"{AUTH}/check-password", json={"phone": next_phone(), "password": "x"}
        )
        assert res.status_code == 200, res.text

    blocked = client.post(
        f"{AUTH}/check-password", json={"phone": next_phone(), "password": "x"}
    )
    assert blocked.status_code == 429, blocked.text


# ═══════════════════════════════════════════════════════════════════
#  ۳) پیوستن با کدِ ۶ رقمی — فضای جست‌وجو فقط یک‌میلیون است
# ═══════════════════════════════════════════════════════════════════
def test_join_by_code_guessing_is_rate_limited(client: Any, rate_limit: Any) -> None:
    """حدسِ پیاپیِ کدِ خانواده بسته می‌شود.

    بی این سقف، `POST /auth/join` یک اوراکلِ شمارشِ کامل بود: یک‌میلیون کدِ ممکن و
    هیچ گیتی. قفلِ per-phone هم بی‌اثر است چون مهاجم شمارهٔ خودش را می‌فرستد و
    فقط کد را عوض می‌کند.
    """
    rate_limit(join_per_ip=3)

    codes = []
    for i in range(4):
        res = client.post(
            f"{AUTH}/join",
            json={
                "code": f"{i:06d}",
                "member_name": "مهاجم",
                "phone": next_phone(),
                "password": PASSWORD,
                "relation": "فرزند",
            },
        )
        codes.append(res.status_code)

    assert codes[:3] == [404, 404, 404], codes  # INVALID_CODE
    assert codes[3] == 429, codes


def test_invite_lookup_shares_the_join_bucket(client: Any, rate_limit: Any) -> None:
    """خواندنِ اطلاعاتِ دعوت هم در همان سطلِ «پیوستن» شمرده می‌شود.

    وگرنه مهاجم می‌توانست با `GET /auth/invite/{token}` بی‌سقف نامِ خانواده‌ها را
    برداشت کند.
    """
    rate_limit(join_per_ip=2)

    assert client.get(f"{AUTH}/invite/deadbeef").status_code == 404
    assert client.get(f"{AUTH}/invite/deadbeee").status_code == 404
    assert client.get(f"{AUTH}/invite/deadbeed").status_code == 429


# ═══════════════════════════════════════════════════════════════════
#  ۴) سطل‌ها به هم نشت نمی‌کنند
# ═══════════════════════════════════════════════════════════════════
def test_buckets_are_isolated_per_route(client: Any, rate_limit: Any) -> None:
    """بستنِ یک مسیر، مسیرهای دیگر را نمی‌بندد.

    اگر `kind` از کلیدِ سطل حذف شود، مهاجم می‌تواند با اشباعِ ارزان‌ترین اندپوینت،
    ورودِ همهٔ کاربران را قطع کند.
    """
    rate_limit(pre_registered_per_ip=1, login_per_ip=5)

    assert client.post(f"{AUTH}/pre-registered", json={"phone": next_phone()}).status_code == 200
    assert client.post(f"{AUTH}/pre-registered", json={"phone": next_phone()}).status_code == 429

    # مسیرِ ورود دست‌نخورده است (۴۰۱ = رسید به منطق، نه ۴۲۹)
    still_open = client.post(
        f"{AUTH}/login", json={"phone": next_phone(), "password": "wrong-password"}
    )
    assert still_open.status_code == 401, still_open.text


def test_zero_limit_means_unlimited(client: Any, rate_limit: Any) -> None:
    """سقفِ صفر = خاموش (قراردادِ پیکربندی که خودِ این مجموعه به آن تکیه دارد)."""
    rate_limit(pre_registered_per_ip=0)

    for _ in range(12):
        res = client.post(f"{AUTH}/pre-registered", json={"phone": next_phone()})
        assert res.status_code == 200, res.text


# ═══════════════════════════════════════════════════════════════════
#  ۵) حریمِ خصوصی: نشانیِ خام و شمارهٔ پرسیده‌شده ذخیره نمی‌شوند
# ═══════════════════════════════════════════════════════════════════
def test_raw_ip_and_phone_are_never_stored(client: Any, raw_sql: Any, rate_limit: Any) -> None:
    """جدولِ سقفِ نرخ نباید به گزارشِ «چه کسی از کجا چه شماره‌ای را پرسید» بدل شود.

    §5 صریح است: «دادهٔ حساس را در لاگ/خطا/سرویسِ ثالث نگذار». اینجا می‌سنجیم که
    ستونِ `scope` هشِ ۳۲هگزی است و هیچ‌جای جدول نه شمارهٔ پرسیده‌شده هست و نه
    چیزی که شکلِ نشانیِ IP داشته باشد.
    """
    from sqlalchemy import text

    rate_limit(pre_registered_per_ip=5)
    probe = "09129998887"
    assert client.post(f"{AUTH}/pre-registered", json={"phone": probe}).status_code == 200

    rows = raw_sql.execute(text("SELECT kind, scope FROM lookup_attempts")).all()
    assert rows, "هیچ ردیفی ثبت نشد — شمارش کار نمی‌کند"

    for kind, scope in rows:
        assert probe not in (scope or ""), "شمارهٔ پرسیده‌شده ذخیره شده است!"
        assert "." not in (scope or ""), f"scope شکلِ IPv4 دارد: {scope}"
        assert ":" not in (scope or ""), f"scope شکلِ IPv6 دارد: {scope}"
        if scope is not None:
            assert len(scope) == 32, f"scope باید هشِ ۳۲هگزی باشد: {scope}"
            int(scope, 16)  # اگر هگز نباشد ValueError می‌دهد
        assert probe not in kind


# ═══════════════════════════════════════════════════════════════════
#  ۶) استخراجِ نشانیِ کلاینت — واحد، بی‌نیاز به HTTP
# ═══════════════════════════════════════════════════════════════════
class _FakeRequest:
    """کمینه‌ترین چیزی که `client_ip` لازم دارد: `.client.host` و `.headers`."""

    class _Client:
        def __init__(self, host: str | None) -> None:
            self.host = host

    def __init__(self, peer: str | None, headers: dict[str, str] | None = None) -> None:
        self.client = self._Client(peer) if peer is not None else None
        self.headers = headers or {}


def test_client_ip_trusts_real_ip_only_from_private_peer() -> None:
    """هدرِ X-Real-IP فقط وقتی باور می‌شود که peer «داخلی» باشد.

    این قلبِ تصمیمِ امنیتیِ `netaddr.py` است: nginx هدر را بازنویسی می‌کند، پس از
    peerِ داخلی قابلِ اعتماد است؛ ولی اگر روزی API بی‌واسطه در معرضِ اینترنت قرار
    گرفت، همان هدر جعل‌شدنی است و نباید سطل را تعیین کند.
    """
    from app.core.netaddr import client_ip

    trusted = _FakeRequest("172.17.0.1", {"x-real-ip": "203.0.113.7"})
    assert client_ip(trusted) == "203.0.113.7"  # type: ignore[arg-type]

    hostile = _FakeRequest("8.8.8.8", {"x-real-ip": "10.0.0.1"})
    assert client_ip(hostile) == "8.8.8.8"  # type: ignore[arg-type]


def test_documentation_ranges_are_not_trusted_as_local_peers() -> None:
    """تلهٔ `is_private`: بازه‌های مستندسازیِ RFC 5737 «خصوصی» گزارش می‌شوند.

    `ipaddress.ip_address("203.0.113.9").is_private` در پایتون **True** است، چون
    `is_private` یعنی «سراسری مسیرپذیر نیست» و شاملِ بازه‌های مستندسازی و محک هم
    می‌شود. نسخهٔ اولِ `netaddr.py` همین را به‌کار می‌برد و در نتیجه به هدرِ جعلیِ
    چنین peerهایی اعتماد می‌کرد. این تست فهرستِ صریحِ `_LOCAL_NETWORKS` را قفل
    می‌کند تا آن رگرسیون برنگردد.
    """
    from app.core.netaddr import client_ip

    for doc_peer in ("192.0.2.5", "198.51.100.5", "203.0.113.5", "198.18.0.5"):
        req = _FakeRequest(doc_peer, {"x-real-ip": "10.0.0.1"})
        assert client_ip(req) == doc_peer, f"به هدرِ {doc_peer} اعتماد شد!"  # type: ignore[arg-type]

    for local_peer in ("127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.1"):
        req = _FakeRequest(local_peer, {"x-real-ip": "8.8.4.4"})
        assert client_ip(req) == "8.8.4.4", f"هدرِ peerِ داخلیِ {local_peer} خوانده نشد"  # type: ignore[arg-type]


def test_client_ip_ignores_forwarded_for_header() -> None:
    """`X-Forwarded-For` عمداً نادیده گرفته می‌شود (append می‌شود و جعل‌شدنی است)."""
    from app.core.netaddr import client_ip

    req = _FakeRequest("127.0.0.1", {"x-forwarded-for": "203.0.113.7, 10.0.0.1"})
    assert client_ip(req) == "127.0.0.1"  # type: ignore[arg-type]


def test_client_ip_falls_back_to_unknown_not_open() -> None:
    """نبودِ نشانی → سطلِ مشترکِ `unknown` (سخت‌گیرانه‌تر)، نه «بی‌سقف»."""
    from app.core.netaddr import client_ip

    assert client_ip(_FakeRequest(None)) == "unknown"  # type: ignore[arg-type]
    assert client_ip(_FakeRequest("testclient")) == "unknown"  # type: ignore[arg-type]
    assert client_ip(_FakeRequest("127.0.0.1", {"x-real-ip": "not-an-ip"})) == "127.0.0.1"  # type: ignore[arg-type]


def test_client_ip_unmaps_ipv4_mapped_form() -> None:
    """`::ffff:1.2.3.4` و `1.2.3.4` باید **یک** سطل باشند.

    بی این باز‌کردن، `str()` شکلِ mapped را `::ffff:102:304` می‌نوشت و همان مبدأ
    دو سطلِ جدا می‌گرفت — یعنی سقفِ مؤثر دو برابر می‌شد.
    """
    from app.core.netaddr import client_ip

    plain = _FakeRequest("10.0.0.5", {"x-real-ip": "1.2.3.4"})
    mapped = _FakeRequest("10.0.0.5", {"x-real-ip": "::ffff:1.2.3.4"})

    assert client_ip(plain) == "1.2.3.4"  # type: ignore[arg-type]
    assert client_ip(mapped) == "1.2.3.4"  # type: ignore[arg-type]
