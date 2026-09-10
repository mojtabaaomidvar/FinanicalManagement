#!/usr/bin/env python3
"""راستی‌آزماییِ ایستایِ ابزارِ مهاجرتِ فاز ۱۰ (کارِ #94) — بدونِ دیتابیس/شبکه.

ثابت‌ها و توابعِ خالصِ backend/migration/migrate_essentials.py را می‌سنجد:
  • national_id همیشه کنار می‌رود.
  • members.avatar_url اجباراً NULL می‌شود.
  • password_hash و phone در سورس اجباری‌اند.
  • ترتیبِ جدول‌ها امنِ کلیدِ خارجی است.
  • جدول‌های RLS-محافظت‌شده شاملِ families/members نیستند و همه در مجموعهٔ ضروری‌اند.
  • FRESH_TABLES با جدول‌های ضروری هم‌پوشانی ندارد.
  • normalize_url و carry_columns درست کار می‌کنند.

psycopg در این محیط لازم نیست؛ با یک ماژولِ ساختگی جایگزین می‌شود تا importِ ماژول کار کند.
اجرا:  python3 backend/scripts/verify_phase10.py
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

# ── جایگزینیِ ساختگیِ psycopg تا importِ ماژولِ مهاجرت بدونِ نصبِ درایور کار کند ──
_fake = types.ModuleType("psycopg")
_fake.sql = types.ModuleType("psycopg.sql")
_fake.Connection = object  # فقط برای type hintهای رشته‌ای
sys.modules.setdefault("psycopg", _fake)
sys.modules.setdefault("psycopg.sql", _fake.sql)

CANDIDATES = [
    Path("/sessions/dazzling-sweet-edison/mnt/personal-finance-pwa/backend/migration/migrate_essentials.py"),
    Path.home() / "Desktop" / "personal-finance-pwa" / "backend" / "migration" / "migrate_essentials.py",
    Path(__file__).resolve().parent.parent / "migration" / "migrate_essentials.py",
]
MOD_PATH = next((p for p in CANDIDATES if p.is_file()), None)
if MOD_PATH is None:
    print("FAIL: migrate_essentials.py پیدا نشد")
    raise SystemExit(1)

spec = importlib.util.spec_from_file_location("migrate_essentials", MOD_PATH)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)  # type: ignore[union-attr]

fails: list[str] = []


def check(name: str, cond: bool) -> None:
    print(f"  {'✓' if cond else '✗'} {name}")
    if not cond:
        fails.append(name)


print("── ثابت‌های مهاجرت ─────────────────────────")
check("national_id در EXCLUDE_COLUMNS است", "national_id" in m.EXCLUDE_COLUMNS)
check("members.avatar_url در FORCE_NULL است", ("members", "avatar_url") in m.FORCE_NULL)
check("password_hash در سورسِ members اجباری است",
      "password_hash" in m.REQUIRED_SOURCE_COLUMNS.get("members", set()))
check("phone در سورسِ members اجباری است",
      "phone" in m.REQUIRED_SOURCE_COLUMNS.get("members", set()))

et = list(m.ESSENTIAL_TABLES)
check("families اولین جدول است", et and et[0] == "families")
check("members پس از families و پیش از accounts است",
      et.index("families") < et.index("members") < et.index("accounts"))
check("همهٔ جدول‌های فرزند پس از families می‌آیند",
      all(et.index("families") < et.index(t) for t in et if t != "families"))
check("۶ جدولِ ضروری تعریف شده", len(et) == 6 and len(set(et)) == 6)

check("RLS_GUARDED زیرمجموعهٔ جدول‌های ضروری است",
      m.RLS_GUARDED_ESSENTIALS <= set(et))
check("families/members در RLS_GUARDED نیستند (بوت‌استرپِ هویت)",
      not ({"families", "members"} & m.RLS_GUARDED_ESSENTIALS))
check("FRESH_TABLES با جدول‌های ضروری هم‌پوشانی ندارد",
      not (set(m.FRESH_TABLES) & set(et)))
check("transactions و sms_messages از صفر شروع می‌شوند",
      {"transactions", "sms_messages"} <= set(m.FRESH_TABLES))

print("\n── دادهٔ مرجع (card_bins) ───────────────────")
check("card_bins در REFERENCE_TABLES است", "card_bins" in m.REFERENCE_TABLES)
check("card_bins جزوِ جدول‌های ضروری نیست", "card_bins" not in et)
check("card_bins جزوِ FRESH نیست (مرجع است، نه دادهٔ کاربر)",
      "card_bins" not in m.FRESH_TABLES)
check("کلیدِ تکرارِ card_bins برابرِ bin است (نه id)",
      m.CONFLICT_KEY.get("card_bins") == "bin")
check("کلیدِ پیش‌فرضِ تکرار برای بقیه id است",
      m.CONFLICT_KEY.get("families", "id") == "id")

print("\n── normalize_url ──────────────────────────")
check("postgresql+psycopg:// → postgresql://",
      m.normalize_url("postgresql+psycopg://u:p@h:5432/db") == "postgresql://u:p@h:5432/db")
check("postgres:// → postgresql://",
      m.normalize_url("postgres://u:p@h/db") == "postgresql://u:p@h/db")
check("postgresql:// بدونِ تغییر می‌ماند",
      m.normalize_url("postgresql://u:p@h/db") == "postgresql://u:p@h/db")

print("\n── carry_columns ──────────────────────────")
# تارگت: id, family_id, national_id, avatar_url, kind(تازه)   سورس: بدونِ kind، همراهِ legacy_col
target = ["id", "family_id", "national_id", "avatar_url", "kind"]
source = {"id", "family_id", "national_id", "avatar_url", "legacy_col"}
carry = m.carry_columns(target, source)
check("national_id از حمل کنار می‌رود", "national_id" not in carry)
check("ستونِ تازهٔ تارگت (kind، نبود در سورس) کنار می‌رود", "kind" not in carry)
check("ستونِ فقط-سورس (legacy_col) وارد نمی‌شود", "legacy_col" not in carry)
check("ترتیبِ carry از تارگت حفظ می‌شود", carry == ["id", "family_id", "avatar_url"])
check("id همیشه در carry هست", "id" in carry)

print()
if fails:
    print(f"✗ شکست: {len(fails)} مورد — {fails}")
    raise SystemExit(1)
print("✓ همهٔ بررسی‌های ایستا سبز شدند.")
