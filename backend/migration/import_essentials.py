#!/usr/bin/env python3
"""ایمپورتِ دادهٔ «فقط ضروری» از فایل‌های JSON به بک‌اندِ اختصاصی (فاز ۱۱).

چرا این نسخه؟ در شبکهٔ ایران نصبِ psycopg روی لپ‌تاپ و اتصالِ مستقیم به Supabase دشوار بود.
به‌جایش مسیرِ «بدونِ نصب» را می‌رویم:

  ۱) روی لپ‌تاپ، export_supabase.mjs با fetchِ داخلیِ Node (بدونِ هیچ وابستگی) جدول‌های
     ضروری را از PostgREST سوپابیس می‌خواند و در migration/export/<table>.json می‌ریزد
     (ستونِ national_id همان‌جا حذف می‌شود؛ روی دیسک نمی‌نشیند).
  ۲) پوشهٔ export/ + همین اسکریپت به سرور scp می‌شود.
  ۳) این اسکریپت «داخلِ کانتینرِ api» (که psycopg دارد) اجرا می‌شود و JSON را در
     Postgresِ مقصد (سرویسِ db، از طریقِ DATABASE_URL خودِ کانتینر) بار می‌کند.

قواعد دقیقاً هم‌سان با migrate_essentials.py:
  • ستون‌های حمل‌شونده = «ستون‌های تارگت ∩ کلیدهای JSON» منهایِ EXCLUDE.
  • national_id هرگز (در اکسپورت حذف شده؛ این‌جا هم safety-net).
  • members.avatar_url اجباراً NULL (فایل‌ها از صفر؛ لینک‌های قدیمی بی‌اعتبارند).
  • members باید password_hash و phone در JSON داشته باشد وگرنه توقف (ورود بدون آن‌ها می‌شکند).
  • یک تراکنش، ترتیبِ کلیدِ خارجی، ON CONFLICT (pk) DO NOTHING، سپس راستی‌آزماییِ شمارش.

نوع‌آگاهی: چون مقادیر از JSON «رشته/عدد» می‌آیند، نوعِ هر ستونِ مقصد را از information_schema
می‌خوانیم و صریحاً تبدیل می‌کنیم (uuid→UUID، timestamptz→datetime، numeric→Decimal، jsonb→Jsonb).

ترتیبِ حیاتیِ RLS همان است:
    alembic upgrade 0001  →  این اسکریپت  →  alembic upgrade head
اگر RLS از قبل روی تارگت فعال باشد، اسکریپت با پیام متوقف می‌شود.

اجرا (روی سرور، داخلِ کانتینر — رمز روی خطِ فرمان نمی‌آید؛ از DATABASE_URLِ .env خوانده می‌شود):
    cd /opt/khaneyar/backend/deploy
    docker compose run --rm -v /opt/khaneyar/backend/migration:/app/migration \
        api python /app/migration/import_essentials.py --dir /app/migration/export --dry-run
    # سپس بدونِ --dry-run

اسرار هرگز چاپ نمی‌شوند؛ فقط نامِ جدول و شمارشِ ردیف.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid as uuidmod
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Iterable

try:
    import psycopg
    from psycopg import sql
    from psycopg.types.json import Jsonb
except ModuleNotFoundError:  # pragma: no cover - راهنمای اجرا
    sys.stderr.write(
        "psycopg (v3) نصب نیست. این اسکریپت باید «داخلِ کانتینرِ api» اجرا شود که psycopg دارد:\n"
        "    cd /opt/khaneyar/backend/deploy\n"
        "    docker compose run --rm -v /opt/khaneyar/backend/migration:/app/migration \\\n"
        "        api python /app/migration/import_essentials.py --dir /app/migration/export\n"
    )
    raise SystemExit(2)


# ── پیکربندیِ ثابت (هم‌سان با migrate_essentials.py) ──────────────────────────

#: جدول‌های ضروری به ترتیبِ امنِ کلیدِ خارجی (والد پیش از فرزند).
ESSENTIAL_TABLES: tuple[str, ...] = (
    "families",          # ریشه
    "members",           # FK → families
    "accounts",          # FK → families, members
    "custom_categories",  # FK → families
    "subcategories",     # FK → families/custom_categories
    "category_budgets",  # FK → families
)

#: جدول‌های مرجعِ ساکن (نه دادهٔ کاربر). با --skip-reference می‌توان صرفِ نظر کرد.
REFERENCE_TABLES: tuple[str, ...] = (
    "card_bins",  # BIN شش‌رقمی → نامِ بانک (کلیدِ اصلی: bin)
)

#: ستونِ تشخیصِ تکرار برای ON CONFLICT (پیش‌فرض id؛ استثناها این‌جا).
CONFLICT_KEY: dict[str, str] = {"card_bins": "bin"}

#: ستون‌هایی که هرگز منتقل نمی‌شوند (سراسری).
EXCLUDE_COLUMNS: frozenset[str] = frozenset({"national_id"})

#: (جدول، ستون)هایی که حمل می‌شوند ولی مقدارشان اجباراً NULL می‌شود.
FORCE_NULL: frozenset[tuple[str, str]] = frozenset({("members", "avatar_url")})

#: ستون‌هایی که «باید» در JSON باشند وگرنه توقف (ورود به آن‌ها وابسته است).
REQUIRED_SOURCE_COLUMNS: dict[str, frozenset[str]] = {
    "members": frozenset({"password_hash", "phone"}),
}

#: جدول‌هایی که عمداً از صفر شروع می‌شوند (فقط برای گزارش؛ لمس نمی‌شوند).
FRESH_TABLES: tuple[str, ...] = (
    "transactions", "transaction_photos", "sms_messages", "sms_bridges",
    "family_events", "sessions", "otp_codes", "auth_attempts",
    "lookup_attempts", "family_invites",
)

#: جدول‌هایی از مجموعهٔ ضروری که در 0002 مشمولِ FORCE RLS می‌شوند (نگهبانِ ترتیب).
RLS_GUARDED_ESSENTIALS: frozenset[str] = frozenset({
    "accounts", "subcategories", "custom_categories", "category_budgets",
})

BATCH = 1000  # اندازهٔ دستهٔ درج


# ── کمکی‌ها ──────────────────────────────────────────────────────────────────

def normalize_url(url: str) -> str:
    """URLِ سبکِ SQLAlchemy را به libpq استاندارد تبدیل می‌کند (psycopg پیشوندِ +driver را نمی‌فهمد)."""
    if url.startswith("postgresql+"):
        url = "postgresql://" + url.split("://", 1)[1]
    elif url.startswith("postgres://"):
        url = "postgresql://" + url.split("://", 1)[1]
    return url


def get_target_url() -> str:
    target = (os.environ.get("TARGET_DATABASE_URL")
              or os.environ.get("DATABASE_URL") or "").strip()
    if not target:
        raise SystemExit(
            "متغیرِ مقصد ست نشده: TARGET_DATABASE_URL (یا DATABASE_URL).\n"
            "داخلِ کانتینرِ api این از .env می‌آید؛ اگر بیرون اجرا می‌کنی خودت ستش کن."
        )
    return normalize_url(target)


def table_columns(conn: "psycopg.Connection", table: str) -> list[tuple[str, str]]:
    """(نام، نوعِ داده) ستون‌های جدول به ترتیبِ ordinal (از information_schema)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )
        return [(r[0], r[1]) for r in cur.fetchall()]


def count_rows(conn: "psycopg.Connection", table: str) -> int:
    with conn.cursor() as cur:
        cur.execute(sql.SQL("SELECT count(*) FROM public.{}").format(sql.Identifier(table)))
        return int(cur.fetchone()[0])


def rls_forced_tables(conn: "psycopg.Connection", tables: Iterable[str]) -> list[str]:
    """از میانِ tables، آن‌هایی که روی تارگت FORCE RLS دارند (نگهبانِ ترتیبِ فاز ۱۰)."""
    names = list(tables)
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = ANY(%s)
              AND c.relforcerowsecurity
            """,
            (names,),
        )
        return [r[0] for r in cur.fetchall()]


def load_json_rows(dir_path: Path, table: str) -> list[dict] | None:
    """فایلِ <table>.json را می‌خواند؛ اگر نبود None برمی‌گرداند (رد می‌شود)."""
    fp = dir_path / f"{table}.json"
    if not fp.exists():
        return None
    with fp.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise SystemExit(f"فایلِ {fp.name} باید آرایهٔ JSON باشد (خروجیِ export_supabase.mjs).")
    return data


def source_columns(rows: list[dict]) -> set[str]:
    cols: set[str] = set()
    for r in rows:
        cols.update(r.keys())
    return cols


def carry_columns(target_cols: list[str], source_cols: set[str]) -> list[str]:
    """ستون‌های حمل‌شونده: در تارگت هست، در JSON هم هست، و در EXCLUDE نیست (ترتیبِ تارگت حفظ می‌شود)."""
    return [c for c in target_cols if c in source_cols and c not in EXCLUDE_COLUMNS]


def adapt_value(table: str, col: str, value, data_type: str):
    """مقدارِ خام از JSON را به نوعِ درستِ پایتونی برای ستونِ مقصد تبدیل می‌کند.

    psycopg آبجکت‌های بومی (UUID/datetime/Decimal/Jsonb/bool/int/str) را با OIDِ درست
    می‌فرستد؛ پس با تبدیلِ صریح، «رشته → uuid/timestamptz/numeric» بی‌ابهام درج می‌شود.
    """
    if (table, col) in FORCE_NULL:
        return None
    if value is None:
        return None
    if data_type == "uuid":
        return value if isinstance(value, uuidmod.UUID) else uuidmod.UUID(str(value))
    if data_type in ("timestamp with time zone", "timestamp without time zone"):
        if isinstance(value, datetime):
            return value
        s = str(value)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    if data_type == "date":
        return value if isinstance(value, date) else date.fromisoformat(str(value))
    if data_type in ("time without time zone", "time with time zone"):
        return value if isinstance(value, time) else time.fromisoformat(str(value))
    if data_type == "numeric":
        return value if isinstance(value, Decimal) else Decimal(str(value))
    if data_type in ("json", "jsonb"):
        return Jsonb(value)
    # text/varchar/char, integer/bigint/smallint, boolean, double precision, real → بدونِ تغییر
    return value


# ── منطقِ اصلی ────────────────────────────────────────────────────────────────

def plan_table(tgt: "psycopg.Connection", dir_path: Path, table: str) -> dict:
    """نقشهٔ ایمپورتِ یک جدول را می‌سازد و اعتبارسنجی می‌کند (بدونِ نوشتن)."""
    tcols = table_columns(tgt, table)
    if not tcols:
        raise SystemExit(f"جدولِ تارگت وجود ندارد: {table} — آیا «alembic upgrade 0001» اجرا شده؟")
    target_names = [c[0] for c in tcols]
    target_type = {c[0]: c[1] for c in tcols}

    rows = load_json_rows(dir_path, table)
    if rows is None:
        return {"table": table, "carry": [], "rows": [], "target_type": target_type,
                "nulled": [], "dropped_present_in_source": [],
                "source_rows": 0, "missing_source": True}

    src_cols = source_columns(rows)

    required = REQUIRED_SOURCE_COLUMNS.get(table, frozenset())
    absent = sorted(required - src_cols)
    if rows and absent:
        raise SystemExit(
            f"ستون‌های حیاتی در JSONِ «{table}» نیستند: {absent}. "
            "بدونِ این‌ها ایمپورت متوقف شد (ورود می‌شکند)."
        )

    carry = carry_columns(target_names, src_cols)
    pk = CONFLICT_KEY.get(table, "id")
    if rows and pk not in carry:
        raise SystemExit(f"کلیدِ «{pk}» برای «{table}» در JSON نیست؛ ایمپورت امن نیست.")

    return {
        "table": table,
        "carry": carry,
        "rows": rows,
        "target_type": target_type,
        "nulled": sorted(c for c in carry if (table, c) in FORCE_NULL),
        "dropped_present_in_source": sorted(c for c in src_cols if c in EXCLUDE_COLUMNS),
        "source_rows": len(rows),
        "missing_source": False,
    }


def copy_table(tgt: "psycopg.Connection", plan: dict) -> int:
    """ردیف‌های یک جدول را با ستون‌های نقشه درج می‌کند. تعدادِ درج‌شده را برمی‌گرداند."""
    table, carry, rows = plan["table"], plan["carry"], plan["rows"]
    if plan["missing_source"] or not carry or not rows:
        return 0
    ttype = plan["target_type"]

    insert_sql = sql.SQL(
        "INSERT INTO public.{tbl} ({cols}) VALUES ({ph}) ON CONFLICT ({pk}) DO NOTHING"
    ).format(
        tbl=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in carry),
        ph=sql.SQL(", ").join(sql.Placeholder() * len(carry)),
        pk=sql.Identifier(CONFLICT_KEY.get(table, "id")),
    )

    inserted = 0
    with tgt.cursor() as wcur:
        batch: list[tuple] = []
        for row in rows:
            batch.append(tuple(adapt_value(table, c, row.get(c), ttype[c]) for c in carry))
            if len(batch) >= BATCH:
                wcur.executemany(insert_sql, batch)
                inserted += len(batch)
                batch = []
        if batch:
            wcur.executemany(insert_sql, batch)
            inserted += len(batch)
    return inserted


def main() -> int:
    ap = argparse.ArgumentParser(description="ایمپورتِ دادهٔ «فقط ضروری» از JSON (فاز ۱۱).")
    ap.add_argument("--dir", required=True,
                    help="پوشهٔ حاویِ <table>.json (خروجیِ export_supabase.mjs).")
    ap.add_argument("--dry-run", action="store_true",
                    help="فقط پیش‌نمایش و شمارش؛ هیچ نوشتنی روی تارگت انجام نمی‌شود.")
    ap.add_argument("--truncate", action="store_true",
                    help="پیش از بار، جدول‌های ضروریِ تارگت را خالی می‌کند (برای اجرای دوبارهٔ تمیز).")
    ap.add_argument("--skip-reference", action="store_true",
                    help="جدولِ مرجعِ ساکن (card_bins) را بار نکن.")
    args = ap.parse_args()

    dir_path = Path(args.dir)
    if not dir_path.is_dir():
        raise SystemExit(f"پوشهٔ داده پیدا نشد: {dir_path}")

    target_url = get_target_url()
    load_tables = ESSENTIAL_TABLES + (() if args.skip_reference else REFERENCE_TABLES)

    print("در حالِ اتصال به تارگت…")
    with psycopg.connect(target_url) as tgt:
        tgt.autocommit = False  # همه‌چیز در یک تراکنش

        # نگهبانِ ترتیبِ RLS: اگر جدول‌های محافظت‌شده روی تارگت FORCE RLS دارند، یعنی 0002
        # اجرا شده و بارِ داده به‌عنوان مالک بسته می‌شود. (در dry-run فقط هشدار.)
        forced = rls_forced_tables(tgt, RLS_GUARDED_ESSENTIALS)
        if forced:
            msg = (
                "RLS روی تارگت از قبل فعال است: " + "، ".join(sorted(forced)) + "\n"
                "دادهٔ ضروری باید «پیش از» مهاجرتِ 0002 بار شود. لطفاً:\n"
                "    docker compose run --rm api alembic downgrade 0001\n"
                "سپس این اسکریپت را دوباره اجرا و بعد: alembic upgrade head\n"
            )
            if not args.dry_run:
                raise SystemExit(msg)
            print("\n⚠ هشدار (dry-run): " + msg)

        # نقشهٔ هر جدول (اعتبارسنجیِ ستون‌ها).
        plans = [plan_table(tgt, dir_path, t) for t in load_tables]

        print("\n── نقشهٔ ایمپورت ─────────────────────────────")
        for p in plans:
            tag = "  [مرجع]" if p["table"] in REFERENCE_TABLES else ""
            if p["missing_source"]:
                print(f"  {p['table']:<18} (فایلِ JSON نبود — رد شد){tag}")
                continue
            print(f"  {p['table']:<18} ردیفِ JSON={p['source_rows']:>6}  ستون‌ها={len(p['carry'])}{tag}")
            if p["dropped_present_in_source"]:
                print(f"      ⊘ کنارگذاشته: {', '.join(p['dropped_present_in_source'])}")
            if p["nulled"]:
                print(f"      ∅ اجباراً NULL: {', '.join(p['nulled'])}")

        if args.skip_reference:
            print("\n  دادهٔ مرجع رد شد (--skip-reference): " + "، ".join(REFERENCE_TABLES))

        print("\n  جدول‌هایی که از صفر شروع می‌شوند (بار نمی‌شوند):")
        print("     " + "، ".join(FRESH_TABLES))

        if args.dry_run:
            print("\n[dry-run] هیچ داده‌ای نوشته نشد. برای اجرای واقعی بدونِ --dry-run اجرا کنید.")
            return 0

        if args.truncate:
            print("\nخالی‌کردنِ جدول‌های تارگت (RESTART IDENTITY CASCADE)…")
            with tgt.cursor() as cur:
                cur.execute(sql.SQL("TRUNCATE {} RESTART IDENTITY CASCADE").format(
                    sql.SQL(", ").join(
                        sql.SQL("public.{}").format(sql.Identifier(t)) for t in load_tables
                    )
                ))

        print("\n── بارِ داده (یک تراکنش) ────────────────────")
        total = 0
        try:
            for p in plans:
                n = copy_table(tgt, p)
                total += n
                print(f"  {p['table']:<18} درج‌شده={n:>6}")
            tgt.commit()
        except Exception:
            tgt.rollback()
            print("\n✗ خطا رخ داد؛ تراکنش برگردانده شد (هیچ ردیفی نماند).")
            raise

        # راستی‌آزماییِ شمارشِ ردیف پس از commit.
        print("\n── راستی‌آزمایی (شمارشِ تارگت) ───────────────")
        ok = True
        for p in plans:
            tgt_n = count_rows(tgt, p["table"])
            src_n = p["source_rows"]
            mark = "✓" if tgt_n >= src_n else "✗"
            if tgt_n < src_n:
                ok = False
            print(f"  {mark} {p['table']:<18} JSON={src_n:>6}  تارگت={tgt_n:>6}")

        print(f"\nمجموعِ ردیفِ درج‌شده: {total}")
        print("انجام شد ✓" if ok else "هشدار: شمارشِ برخی جدول‌ها کمتر از JSON است — بررسی کنید.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
