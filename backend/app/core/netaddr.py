"""استخراجِ نشانیِ واقعیِ کلاینت از پشتِ nginx — با پیش‌فرضِ «اعتمادِ حدّاقلی».

# مسئله
تا پیش از این، هیچ مسیری در کلِ بک‌اند شیءِ `Request` را نمی‌گرفت و uvicorn هم
بدونِ `--proxy-headers` بالا می‌آید؛ یعنی سرور اصلاً نمی‌دانست درخواست از کدام
نشانی آمده. بی این دانستن، هر سقفِ نرخی ناچار «سراسری» می‌شود و یک مهاجم می‌تواند
با مصرفِ همان سطلِ سراسری، ورودِ همهٔ کاربران را از کار بیندازد (DoS) — یا برعکس،
اگر سطل را بزرگ بگیریم، حدس‌زدنِ رمز/کد روی هزار شمارهٔ مختلف بی‌مانع می‌ماند.

# چرا خواندنِ هدر اینجا امن است (و کجا نامن می‌شود)
هدرِ `X-Forwarded-For` را کلاینت می‌تواند جعل کند، پس عمداً **استفاده نمی‌شود**.
تنها هدرِ مرجع `X-Real-IP` است، چون در `deploy/nginx/khaneyar.conf` با
`proxy_set_header X-Real-IP $remote_addr;` **بازنویسی** می‌شود (نه افزودن)، پس
هر مقداری که کلاینت فرستاده باشد دور ریخته می‌شود.

این اعتماد دو شرطِ نگه‌دارنده دارد:
  ۱) پورتِ ۸۰۰۰ فقط روی `127.0.0.1` بسته شده باشد (در `deploy/docker-compose.yml`
     همین‌طور است) تا هیچ‌کس نتواند بی‌واسطهٔ nginx به API برسد.
  ۲) هدر فقط وقتی خوانده شود که خودِ peer «پروکسیِ خودی» باشد.

شرطِ دوم را همین ماژول اعمال می‌کند. چون در چیدمانِ Docker، peer از نگاهِ درونِ
کانتینر نه `127.0.0.1` است بلکه دروازهٔ پلِ داکر (مثلِ `172.17.0.1`)، فهرستِ
سخت‌کدشدهٔ loopback کار نمی‌کرد؛ پس پیش‌فرض این است: **هر peerِ loopback یا خصوصیِ
RFC1918/ULA مورد اعتماد است**. این امن است چون کلاینتِ اینترنتی هرگز نمی‌تواند با
نشانیِ خصوصی به‌عنوان peer ظاهر شود. اگر روزی چیدمان عوض شد،
`TRUSTED_PROXY_IPS=…` فهرستِ صریح را جای این حدس می‌گذارد.

# رفتارِ شکست
اگر هیچ نشانی‌ای پیدا نشد (مثلِ فراخوانیِ درون‌فرایندیِ TestClient)، رشتهٔ
`"unknown"` برمی‌گردد — یعنی همهٔ چنین درخواست‌هایی در یک سطل می‌افتند و سقف
سخت‌گیرانه‌تر عمل می‌کند، نه بازتر (fail-closed).
"""

from __future__ import annotations

import ipaddress

from fastapi import Request

from app.core.config import settings

_UNKNOWN = "unknown"

# هدرِ تنها-مرجع. `X-Forwarded-For` عمداً نادیده گرفته می‌شود چون append می‌شود و
# بخشِ سمتِ چپش را کلاینت می‌نویسد.
_REAL_IP_HEADER = "x-real-ip"

# ── «peerِ داخلی» با فهرستِ صریح، نه با `addr.is_private` ──────────────
# تلهٔ کشف‌شده: `ipaddress.ip_address("203.0.113.9").is_private` در پایتون **True**
# است! چون `is_private` یعنی «به‌طورِ سراسری مسیرپذیر نیست» و بازه‌های مستندسازیِ
# RFC 5737 (`192.0.2.0/24`، `198.51.100.0/24`، `203.0.113.0/24`) و بازهٔ محک
# (`198.18.0.0/15`) را هم در بر می‌گیرد. تکیه بر آن یعنی به هدرِ جعلیِ یک peer
# «مستندسازی» اعتماد می‌کردیم. پس فهرست را صریح و قابلِ ممیزی می‌نویسیم.
_LOCAL_NETWORKS = tuple(
    ipaddress.ip_network(cidr)
    for cidr in (
        "127.0.0.0/8",      # loopback IPv4
        "::1/128",          # loopback IPv6
        "10.0.0.0/8",       # RFC 1918
        "172.16.0.0/12",    # RFC 1918 — پلِ پیش‌فرضِ داکر (۱۷۲.۱۷.۰.۱) اینجاست
        "192.168.0.0/16",   # RFC 1918
        "169.254.0.0/16",   # link-local IPv4
        "fe80::/10",        # link-local IPv6
        "fc00::/7",         # ULA IPv6
    )
)


def _is_local_peer(host: str) -> bool:
    """آیا peer در یکی از شبکه‌های «داخلِ ماشین/شبکهٔ خودی» است؟"""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(addr in net for net in _LOCAL_NETWORKS if addr.version == net.version)


def _peer_is_trusted_proxy(peer: str | None) -> bool:
    """آیا مجازیم هدرِ X-Real-IP این peer را باور کنیم؟"""
    if not peer:
        return False
    explicit = settings.trusted_proxy_list
    if explicit:
        return peer in explicit          # فهرستِ صریح، هیچ حدسی
    return _is_local_peer(peer)          # پیش‌فرض: فقط peerِ داخلی


def _normalize(raw: str | None) -> str | None:
    """اعتبارسنجیِ شکلِ نشانی؛ ورودیِ بی‌ریخت را دور می‌ریزد (نه اینکه ذخیره کند).

    شکلِ IPv4-mapped (`::ffff:1.2.3.4`) به همان IPv4 باز می‌شود؛ وگرنه `str()`
    آن را `::ffff:102:304` می‌نوشت و یک مبدأ **دو سطلِ جدا** می‌گرفت — یعنی سقف با
    عوض‌کردنِ شکلِ نشانی دو برابر می‌شد.
    """
    if not raw:
        return None
    candidate = raw.strip()
    if not candidate:
        return None
    try:
        addr = ipaddress.ip_address(candidate)
    except ValueError:
        return None
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped is not None:
        return str(addr.ipv4_mapped)
    return str(addr)


def client_ip(request: Request) -> str:
    """نشانیِ کلاینت برای کلیدِ سقفِ نرخ — همیشه رشته، هرگز None.

    ترتیبِ اولویت: هدرِ X-Real-IP (تنها اگر peer پروکسیِ خودی باشد) ← peerِ خودِ
    اتصال ← `"unknown"`.
    """
    peer = request.client.host if request.client else None

    if _peer_is_trusted_proxy(peer):
        forwarded = _normalize(request.headers.get(_REAL_IP_HEADER))
        if forwarded is not None:
            return forwarded

    return _normalize(peer) or _UNKNOWN
