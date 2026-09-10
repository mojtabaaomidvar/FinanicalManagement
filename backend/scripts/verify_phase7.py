#!/usr/bin/env python3
"""راستی‌آزماییِ ایستای فاز ۷ (بدونِ دیتابیس/شبکه) — «خانه‌یار» بک‌اند.

سه چیز را ثابت می‌کند:
 ۱) پوششِ RPC: هر rpc()‌ای که فرانت صدا می‌زند دقیقاً یک اندپوینتِ متناظر (متد+مسیر)
    در بک‌اند دارد و هیچ RPCی بی‌نگاشت نمانده است.
 ۲) مرزِ وابستگی: روت‌های «داده» فقط get_tenant_member (RLS/fail-closed) دارند و
    روت‌های «هویتی» (members.py) فقط get_current_member/require_owner (بیرون از RLS).
 ۳) گاردِ مدیر در لایهٔ سرویس: بودجهٔ دسته و تنظیماتِ خانواده فقط-مدیر؛ نسبتِ مدیر ثابت.

خروجی: جدول + شمارشِ PASS/FAIL؛ کدِ خروجِ ۱ در صورتِ هر شکست.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve()
# ریشهٔ پروژه را از روی ساختار پیدا کن (اسکریپت در outputs اجرا می‌شود)
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
REPOS = PROJECT / "src" / "infrastructure" / "repositories"

DATA_ROUTE_FILES = {"transactions", "accounts", "categories", "sms", "events"}
IDENTITY_ROUTE_FILE = "members"
TENANT_DEP = "get_tenant_member"
IDENTITY_DEPS = {"get_current_member", "require_owner", "get_principal"}

failures: list[str] = []
notes: list[str] = []


def check(cond: bool, ok_msg: str, fail_msg: str) -> None:
    if cond:
        print(f"  ✅ {ok_msg}")
    else:
        print(f"  ❌ {fail_msg}")
        failures.append(fail_msg)


# ── ۰) نگاشتِ مرجع RPC → (متد، مسیر) ─────────────────────────
RPC_TO_ENDPOINT: dict[str, tuple[str, str]] = {
    # احراز هویت / هویت (فاز ۴)
    "get_public_config": ("GET", "/auth/config"),
    "auth_check_password": ("POST", "/auth/check-password"),
    "check_pre_registered": ("POST", "/auth/pre-registered"),
    "auth_login": ("POST", "/auth/login"),
    "auth_register": ("POST", "/auth/register"),
    "accept_invite": ("POST", "/auth/accept-invite"),
    "get_invite": ("GET", "/auth/invite/{}"),
    "create_invite": ("POST", "/auth/invite"),
    "validate_session": ("GET", "/auth/session"),
    "logout_session": ("POST", "/auth/logout"),
    "logout_all_sessions": ("POST", "/auth/logout-all"),
    "change_password": ("POST", "/auth/change-password"),
    "get_family": ("GET", "/auth/family"),
    "get_members": ("GET", "/auth/members"),
    "add_member_by_manager": ("POST", "/auth/members"),
    "remove_member": ("DELETE", "/auth/members/{}"),
    # حساب‌ها
    "list_accounts": ("GET", "/accounts"),
    "add_account": ("POST", "/accounts"),
    "update_account": ("PATCH", "/accounts/{}"),
    "delete_account": ("DELETE", "/accounts/{}"),
    # تراکنش‌ها
    "list_transactions": ("GET", "/transactions"),
    "add_transaction": ("POST", "/transactions"),
    "update_transaction": ("PATCH", "/transactions/{}"),
    "delete_transaction": ("DELETE", "/transactions/{}"),
    "mark_recurring_occurrence": ("POST", "/transactions/{}/occurrences"),
    "add_tx_photo": ("POST", "/transactions/{}/photos"),
    "update_tx_photo_caption": ("PATCH", "/photos/{}"),
    "delete_tx_photo": ("DELETE", "/photos/{}"),
    # زیردسته‌ها / دسته‌های سفارشی / بودجهٔ دسته‌ها
    "list_subcategories": ("GET", "/subcategories"),
    "add_subcategory": ("POST", "/subcategories"),
    "delete_subcategory": ("DELETE", "/subcategories/{}"),
    "list_custom_categories": ("GET", "/custom-categories"),
    "add_custom_category": ("POST", "/custom-categories"),
    "delete_custom_category": ("DELETE", "/custom-categories/{}"),
    "list_category_budgets": ("GET", "/category-budgets"),
    "set_category_budget": ("POST", "/category-budgets"),
    "delete_category_budget": ("DELETE", "/category-budgets/{}"),
    # پیامک / پل
    "list_sms": ("GET", "/sms"),
    "add_sms_messages": ("POST", "/sms"),
    "set_sms_status": ("PATCH", "/sms/{}"),
    "get_bridge": ("GET", "/sms/bridge"),
    "create_bridge": ("POST", "/sms/bridge"),
    # رویدادها
    "list_events": ("GET", "/events"),
    "add_event": ("POST", "/events"),
    "delete_event": ("DELETE", "/events/{}"),
    "sync_birthday_events": ("POST", "/events/sync-birthdays"),
    # تنظیماتِ خانواده / پروفایلِ عضو (فاز ۷ — بیرون از RLS)
    "update_family_settings": ("PATCH", "/family/settings"),
    "update_member_profile": ("PATCH", "/members/me"),
    "set_member_theme": ("PATCH", "/members/me/theme"),
    "set_member_currency": ("PATCH", "/members/me/currency"),
    "set_member_relation": ("PATCH", "/members/{}/relation"),
}

# فاز ۷ (نوشتن) — برای گزارش تفکیک می‌شود
PHASE7_WRITE_RPCS = {
    "add_account", "update_account", "delete_account",
    "add_transaction", "update_transaction", "delete_transaction",
    "mark_recurring_occurrence", "add_tx_photo", "update_tx_photo_caption", "delete_tx_photo",
    "add_subcategory", "delete_subcategory",
    "add_custom_category", "delete_custom_category",
    "set_category_budget", "delete_category_budget",
    "add_sms_messages", "set_sms_status", "create_bridge",
    "add_event", "delete_event", "sync_birthday_events",
    "update_family_settings", "update_member_profile",
    "set_member_theme", "set_member_currency", "set_member_relation",
    "add_member_by_manager", "remove_member",
}


def norm_path(p: str) -> str:
    """پارامترهای مسیر را به {} یکسان کن تا مقایسه به نامِ پارامتر حساس نباشد."""
    return re.sub(r"\{[^}]+\}", "{}", p)


# ── ۱) استخراجِ RPCهای فرانت ─────────────────────────────────
RPC_CALL = re.compile(r"rpc\s*(?:<[^>]*>)?\s*\(\s*[\"']([a-z_]+)[\"']")
frontend_rpcs: set[str] = set()
for ts in sorted(REPOS.glob("*.ts")):
    frontend_rpcs |= set(RPC_CALL.findall(ts.read_text(encoding="utf-8")))


# ── ۲) تحلیلِ AST روت‌های بک‌اند ──────────────────────────────
class Route:
    __slots__ = ("file", "method", "path", "deps", "func")

    def __init__(self, file: str, method: str, path: str, deps: set[str], func: str):
        self.file, self.method, self.path, self.deps, self.func = file, method, path, deps, func


def extract_prefix(tree: ast.AST) -> str:
    """prefix از APIRouter(prefix="...") اگر باشد."""
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "APIRouter":
            for kw in node.keywords:
                if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                    return str(kw.value.value)
    return ""


def deps_of(func: ast.FunctionDef) -> set[str]:
    """نامِ توابعِ Depends(...) در پیش‌فرضِ پارامترها."""
    found: set[str] = set()
    for default in list(func.args.defaults) + list(func.args.kw_defaults):
        if isinstance(default, ast.Call) and isinstance(default.func, ast.Name) and default.func.id == "Depends":
            if default.args:
                a = default.args[0]
                if isinstance(a, ast.Name):
                    found.add(a.id)
                elif isinstance(a, ast.Attribute):
                    found.add(a.attr)
    return found


HTTP_METHODS = {"get", "post", "patch", "delete", "put"}
all_routes: list[Route] = []
for py in sorted(ROUTES.glob("*.py")):
    if py.name == "__init__.py":
        continue
    tree = ast.parse(py.read_text(encoding="utf-8"))
    prefix = extract_prefix(tree)
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
                method = dec.func.attr.upper()
                path = prefix + str(dec.args[0].value)
                all_routes.append(Route(py.stem, method, path, deps_of(node), node.name))

route_index = {(r.method, norm_path(r.path)) for r in all_routes}


# ── تستِ ۱: پوششِ RPC ────────────────────────────────────────
print("① پوششِ RPC (فرانت → اندپوینت)")
unmapped = sorted(frontend_rpcs - set(RPC_TO_ENDPOINT))
check(not unmapped, f"همهٔ {len(frontend_rpcs)} RPC فرانت نگاشت دارند", f"RPC بی‌نگاشت: {unmapped}")

missing_endpoints = []
for name in sorted(frontend_rpcs):
    if name not in RPC_TO_ENDPOINT:
        continue
    method, path = RPC_TO_ENDPOINT[name]
    if (method, norm_path(path)) not in route_index:
        missing_endpoints.append(f"{name} → {method} {path}")
check(not missing_endpoints, "هر RPC یک اندپوینتِ متناظر دارد", f"اندپوینتِ گم‌شده: {missing_endpoints}")

covered_writes = sorted(r for r in PHASE7_WRITE_RPCS if r in frontend_rpcs)
notes.append(f"RPCهای نوشتنِ پوشش‌داده‌شده (فاز ۷): {len(covered_writes)} از {len(PHASE7_WRITE_RPCS)}")


# ── تستِ ۲: مرزِ وابستگی ─────────────────────────────────────
print("\n② مرزِ وابستگی (RLS داده در برابر هویتیِ بیرون از RLS)")
data_routes = [r for r in all_routes if r.file in DATA_ROUTE_FILES]
bad_data = [
    f"{r.file}:{r.func} deps={sorted(r.deps)}"
    for r in data_routes
    if TENANT_DEP not in r.deps or (r.deps & IDENTITY_DEPS)
]
check(
    not bad_data,
    f"همهٔ {len(data_routes)} روتِ داده فقط {TENANT_DEP} دارند",
    f"روتِ دادهٔ نادرست: {bad_data}",
)

identity_routes = [r for r in all_routes if r.file == IDENTITY_ROUTE_FILE]
bad_identity = [
    f"{r.func} deps={sorted(r.deps)}"
    for r in identity_routes
    if TENANT_DEP in r.deps or not (r.deps & IDENTITY_DEPS)
]
check(
    identity_routes and not bad_identity,
    f"همهٔ {len(identity_routes)} روتِ هویتی (members) بیرون از RLS و با گاردِ هویت‌اند",
    f"روتِ هویتیِ نادرست: {bad_identity}",
)

fam_settings = [r for r in identity_routes if r.func == "update_family_settings"]
check(
    len(fam_settings) == 1 and "require_owner" in fam_settings[0].deps,
    "PATCH /family/settings زیرِ require_owner است (فقط مدیر)",
    "PATCH /family/settings گاردِ require_owner ندارد",
)

# مدیریتِ اعضا در auth باید فقط-مدیر باشد
auth_routes = {(r.method, r.func): r for r in all_routes if r.file == "auth"}
for key, label in [
    (("POST", "add_member"), "POST /auth/members"),
    (("DELETE", "remove_member"), "DELETE /auth/members/{id}"),
    (("POST", "create_invite"), "POST /auth/invite"),
]:
    r = auth_routes.get(key)
    check(
        r is not None and "require_owner" in r.deps,
        f"{label} زیرِ require_owner است",
        f"{label} گاردِ require_owner ندارد",
    )


# ── تستِ ۳: گاردِ مدیر در لایهٔ سرویس ────────────────────────
print("\n③ گاردِ مدیر/قواعد در لایهٔ سرویس")


def func_src(path: Path, name: str) -> str:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return ast.get_source_segment(path.read_text(encoding="utf-8"), node) or ""
    return ""


cat_src = SERVICES / "categories.py"
for fn in ("set_category_budget", "delete_category_budget"):
    src = func_src(cat_src, fn)
    check(
        'role != "owner"' in src and "FORBIDDEN" in src,
        f"categories.{fn} گاردِ فقط-مدیر دارد",
        f"categories.{fn} گاردِ فقط-مدیر ندارد",
    )

fam_src = SERVICES / "family.py"
ufs = func_src(fam_src, "update_family_settings")
check(
    'role != "owner"' in ufs and "FORBIDDEN" in ufs,
    "family.update_family_settings گاردِ فقط-مدیر دارد",
    "family.update_family_settings گاردِ فقط-مدیر ندارد",
)
smr = func_src(fam_src, "set_member_relation")
check(
    "OWNER_RELATION_FIXED" in smr,
    "family.set_member_relation نسبتِ مدیر را ثابت نگه می‌دارد (OWNER_RELATION_FIXED)",
    "family.set_member_relation گاردِ OWNER_RELATION_FIXED ندارد",
)


# ── جمع‌بندی ─────────────────────────────────────────────────
print("\n── یادداشت‌ها ──")
for n in notes:
    print(f"  • {n}")
print(f"\nمسیرهای بک‌اند: {len(all_routes)} | RPCهای فرانت: {len(frontend_rpcs)}")
if failures:
    print(f"\nنتیجه: ❌ {len(failures)} شکست")
    sys.exit(1)
print("\nنتیجه: ✅ همهٔ بررسی‌ها گذشت")
