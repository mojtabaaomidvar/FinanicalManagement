#!/usr/bin/env python3
"""راستی‌آزماییِ ایستای فاز ۸ (بدونِ دیتابیس/شبکه/pydantic) — «خانه‌یار» بک‌اند.

فاز ۸ = ingestِ پیامکِ سمت‌سرور + آپلودِ فایل به استوریجِ خصوصی. این اسکریپت فقط با
AST و متن کار می‌کند (هیچ importی از app انجام نمی‌دهد؛ VM وابستگیِ شخص‌ثالث ندارد) و
این نامتغیرها را ثابت می‌کند:

 ۱) سیم‌کشیِ روتر: uploads/files/webhooks در router.py include شده‌اند.
 ۲) ingestِ پیامک:
      • POST /sms/ingest در sms.py با get_tenant_member (نشست‌محور، RLS).
      • POST /sms/bridge-ingest در webhooks.py «بدونِ» وابستگیِ نشست/هویت است
        (احراز با «توکنِ پل» در بدنه — استثنای آگاهانه و مستند).
 ۳) مرزِ فاز ۷ دست‌نخورده: فایل‌های روتِ «داده» (شاملِ sms.py) هنوز فقط get_tenant_member
    دارند؛ webhooks.py یک فایلِ جدا است تا این مرز نشکند.
 ۴) آپلود: /uploads/avatar و /uploads/photo با get_current_member (Bearer، نه tenant).
 ۵) سروِ فایل: GET /files/{path} «بدونِ» هیچ وابستگیِ احراز (مجوز در امضای HMAC).
 ۶) سرویس/اسکیما/مهاجرت: توابع و مدل‌ها و مهاجرتِ 0003 (خروج sms_bridges از RLS) موجودند.
 ۷) fail-closedِ پل: ingest_via_bridge برای توکنِ نبود/نامعتبر UNAUTHORIZED می‌دهد و
    زمینهٔ خانواده را ست و در finally ریست می‌کند.

خروجی: جدول + شمارشِ PASS/FAIL؛ کدِ خروجِ ۱ در صورتِ هر شکست.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

CANDIDATES = [
    Path("/sessions/dazzling-sweet-edison/mnt/personal-finance-pwa"),
    Path.home() / "Desktop" / "personal-finance-pwa",
]
PROJECT = next((p for p in CANDIDATES if (p / "backend").is_dir()), None)
if PROJECT is None:
    print("FAIL: ریشهٔ پروژه پیدا نشد")
    sys.exit(1)

BACKEND = PROJECT / "backend"
ROUTES = BACKEND / "app" / "api" / "v1" / "routes"
SERVICES = BACKEND / "app" / "services"
SCHEMAS = BACKEND / "app" / "schemas" / "data.py"
ROUTER = BACKEND / "app" / "api" / "v1" / "router.py"
MIGRATIONS = BACKEND / "alembic" / "versions"

DATA_ROUTE_FILES = {"transactions", "accounts", "categories", "sms", "events"}
TENANT_DEP = "get_tenant_member"
SESSION_DEPS = {"get_tenant_member", "get_current_member", "require_owner", "get_principal"}

failures: list[str] = []
notes: list[str] = []


def check(cond: bool, ok_msg: str, fail_msg: str) -> None:
    if cond:
        print(f"  ✅ {ok_msg}")
    else:
        print(f"  ❌ {fail_msg}")
        failures.append(fail_msg)


# ── تحلیلِ AST روت‌ها (متد/مسیر/وابستگی‌ها، مثلِ verify_phase7) ──
HTTP_METHODS = {"get", "post", "patch", "delete", "put"}


class Route:
    __slots__ = ("file", "method", "path", "deps", "func")

    def __init__(self, file: str, method: str, path: str, deps: set[str], func: str):
        self.file, self.method, self.path, self.deps, self.func = file, method, path, deps, func


def deps_of(func: ast.FunctionDef) -> set[str]:
    found: set[str] = set()
    for default in list(func.args.defaults) + list(func.args.kw_defaults):
        if (
            isinstance(default, ast.Call)
            and isinstance(default.func, ast.Name)
            and default.func.id == "Depends"
            and default.args
        ):
            a = default.args[0]
            if isinstance(a, ast.Name):
                found.add(a.id)
            elif isinstance(a, ast.Attribute):
                found.add(a.attr)
    return found


def routes_in(py: Path) -> list[Route]:
    tree = ast.parse(py.read_text(encoding="utf-8"))
    out: list[Route] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef):
            continue
        for dec in node.decorator_list:
            if (
                isinstance(dec, ast.Call)
                and isinstance(dec.func, ast.Attribute)
                and isinstance(dec.func.value, ast.Name)
                and dec.func.value.id == "router"
                and dec.func.attr in HTTP_METHODS
                and dec.args
                and isinstance(dec.args[0], ast.Constant)
            ):
                out.append(
                    Route(py.stem, dec.func.attr.upper(), str(dec.args[0].value), deps_of(node), node.name)
                )
    return out


all_routes: list[Route] = []
for py in sorted(ROUTES.glob("*.py")):
    if py.name == "__init__.py":
        continue
    all_routes.extend(routes_in(py))


def find(method: str, path: str, file: str | None = None) -> Route | None:
    for r in all_routes:
        if r.method == method and r.path == path and (file is None or r.file == file):
            return r
    return None


def defs_in(py: Path) -> set[str]:
    """نامِ توابع/کلاس‌های سطحِ ماژول."""
    tree = ast.parse(py.read_text(encoding="utf-8"))
    return {
        n.name
        for n in tree.body
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }


# ── ۱) سیم‌کشیِ روتر ──────────────────────────────────────────
print("① سیم‌کشیِ روتر (include_router)")
router_src = ROUTER.read_text(encoding="utf-8")
for mod in ("uploads", "files", "webhooks"):
    check(
        f"{mod}.router" in router_src and f"include_router({mod}.router)" in router_src,
        f"router.py شاملِ {mod}.router است",
        f"router.py شاملِ {mod}.router نیست",
    )


# ── ۲) ingestِ پیامک ─────────────────────────────────────────
print("\n② ingestِ پیامک (نشست در برابر توکنِ پل)")
r_ingest = find("POST", "/sms/ingest", "sms")
check(
    r_ingest is not None and TENANT_DEP in r_ingest.deps,
    "POST /sms/ingest در sms.py با get_tenant_member (نشست‌محور، RLS)",
    "POST /sms/ingest نبود یا get_tenant_member ندارد",
)
r_bridge = find("POST", "/sms/bridge-ingest", "webhooks")
check(
    r_bridge is not None and not (r_bridge.deps & SESSION_DEPS),
    "POST /sms/bridge-ingest در webhooks.py بدونِ وابستگیِ نشست/هویت (توکنِ پل)",
    f"POST /sms/bridge-ingest نبود یا وابستگیِ نشست دارد: "
    f"{sorted(r_bridge.deps) if r_bridge else 'نبود'}",
)


# ── ۳) مرزِ فاز ۷ دست‌نخورده ─────────────────────────────────
print("\n③ مرزِ فاز ۷ (روت‌های داده فقط get_tenant_member)")
data_routes = [r for r in all_routes if r.file in DATA_ROUTE_FILES]
bad_data = [
    f"{r.file}:{r.func} deps={sorted(r.deps)}"
    for r in data_routes
    if TENANT_DEP not in r.deps or (r.deps & (SESSION_DEPS - {TENANT_DEP}))
]
check(
    not bad_data,
    f"همهٔ {len(data_routes)} روتِ داده (شاملِ /sms/ingest) فقط {TENANT_DEP} دارند",
    f"روتِ دادهٔ نادرست: {bad_data}",
)
# webhooks یک فایلِ جدا از روت‌های داده است (نه در DATA_ROUTE_FILES)
check(
    "webhooks" not in DATA_ROUTE_FILES and (ROUTES / "webhooks.py").is_file(),
    "webhooks.py فایلی جدا از روت‌های داده است (مرزِ «هویت فقط از Bearer» حفظ شد)",
    "webhooks.py جدا نیست",
)


# ── ۴) آپلودِ فایل (Bearer، نه tenant) ───────────────────────
print("\n④ آپلودِ فایل (get_current_member)")
for path in ("/uploads/avatar", "/uploads/photo"):
    r = find("POST", path, "uploads")
    check(
        r is not None and "get_current_member" in r.deps and TENANT_DEP not in r.deps,
        f"POST {path} با get_current_member (Bearer، بیرون از RLS)",
        f"POST {path} نبود یا وابستگیِ نادرست دارد",
    )


# ── ۵) سروِ فایل بدونِ احراز (مجوز در امضای HMAC) ────────────
print("\n⑤ سروِ فایل (بدونِ وابستگیِ احراز؛ HMAC)")
r_files = find("GET", "/files/{path:path}", "files")
if r_files is None:  # نامِ پارامتر ممکن است فرق کند
    r_files = next((r for r in all_routes if r.file == "files" and r.method == "GET"), None)
check(
    r_files is not None and not (r_files.deps & SESSION_DEPS),
    "GET /files/{path} بدونِ هیچ وابستگیِ احراز است (مجوز در sig)",
    f"روتِ سروِ فایل نبود یا وابستگیِ احراز دارد: "
    f"{sorted(r_files.deps) if r_files else 'نبود'}",
)
files_src = (ROUTES / "files.py").read_text(encoding="utf-8")
check(
    "verify_path" in files_src and "FORBIDDEN" in files_src,
    "files.py امضا را با verify_path بررسی و در نبودِ آن FORBIDDEN می‌دهد (fail-closed)",
    "files.py بررسیِ امضا/FORBIDDEN ندارد",
)


# ── ۶) سرویس/اسکیما/مهاجرت ───────────────────────────────────
print("\n⑥ سرویس‌ها، اسکیماها و مهاجرت")
msg_defs = defs_in(SERVICES / "messaging.py")
for fn in ("ingest_sms", "ingest_via_bridge", "_row_from_raw"):
    check(fn in msg_defs, f"messaging.{fn} تعریف شده", f"messaging.{fn} نبود")

storage_defs = defs_in(SERVICES / "storage.py")
for fn in ("decode_data_url", "sign_path", "verify_path", "build_url", "require_configured"):
    check(fn in storage_defs, f"storage.{fn} تعریف شده", f"storage.{fn} نبود")

schema_defs = defs_in(SCHEMAS)
for cls in ("SmsIngestItem", "SmsIngestBatch", "BridgeIngest", "IngestResult", "UploadIn", "UploadOut"):
    check(cls in schema_defs, f"schemas.data.{cls} تعریف شده", f"schemas.data.{cls} نبود")

mig_0003 = MIGRATIONS / "0003_sms_bridges_no_rls.py"
if mig_0003.is_file():
    mig_src = mig_0003.read_text(encoding="utf-8")
    # انتساب ممکن است تایپ‌دار باشد: `revision: str = "0003"` — با AST مقدارِ ثابتِ
    # سطحِ ماژول را می‌خوانیم تا به قالبِ نگارش حساس نباشیم.
    mig_tree = ast.parse(mig_src)
    mig_vals: dict[str, object] = {}
    for node in mig_tree.body:
        target = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target = node.targets[0].id
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target = node.target.id
        if target in ("revision", "down_revision") and isinstance(getattr(node, "value", None), ast.Constant):
            mig_vals[target] = node.value.value
    check(
        "sms_bridges" in mig_src
        and mig_vals.get("revision") == "0003"
        and mig_vals.get("down_revision") == "0002",
        "مهاجرتِ 0003 (خروجِ sms_bridges از RLS) با زنجیرهٔ درستِ 0002→0003",
        f"مهاجرتِ 0003 زنجیره/محتوای درست ندارد (revision={mig_vals.get('revision')!r}, "
        f"down_revision={mig_vals.get('down_revision')!r})",
    )
else:
    check(False, "", "فایلِ مهاجرتِ 0003_sms_bridges_no_rls.py پیدا نشد")


# ── ۷) fail-closedِ پل ───────────────────────────────────────
print("\n⑦ رفتارِ ingest_via_bridge")
msg_src = (SERVICES / "messaging.py").read_text(encoding="utf-8")
tree = ast.parse(msg_src)
bridge_fn_src = ""
for node in ast.walk(tree):
    if isinstance(node, ast.FunctionDef) and node.name == "ingest_via_bridge":
        bridge_fn_src = ast.get_source_segment(msg_src, node) or ""
        break
check(
    'AppError("UNAUTHORIZED"' in bridge_fn_src,
    "ingest_via_bridge برای توکنِ نبود/نامعتبر UNAUTHORIZED می‌دهد (fail-closed)",
    "ingest_via_bridge گاردِ UNAUTHORIZED ندارد",
)
check(
    "set_current_family" in bridge_fn_src
    and "apply_to_transaction" in bridge_fn_src
    and "reset_current_family" in bridge_fn_src
    and "finally" in bridge_fn_src,
    "ingest_via_bridge زمینهٔ خانواده را دستی ست و در finally ریست می‌کند",
    "ingest_via_bridge مدیریتِ زمینهٔ خانواده (ست/ریست در finally) ندارد",
)


# ── جمع‌بندی ─────────────────────────────────────────────────
print("\n── یادداشت‌ها ──")
notes.append(f"روت‌های اسکن‌شده: {len(all_routes)}")
notes.append("استثنای آگاهانه: bridge-ingest تنها روتِ بدونِ Bearer است (توکنِ پل).")
for n in notes:
    print(f"  • {n}")

if failures:
    print(f"\nنتیجه: ❌ {len(failures)} شکست")
    sys.exit(1)
print("\nنتیجه: ✅ همهٔ بررسی‌های فاز ۸ گذشت")
