#!/usr/bin/env python3
"""مهاجرتِ دادهٔ «فقط ضروری» از سوپابیس به بک‌اندِ اختصاصی (فاز ۱۰، کارِ #94).

این ابزار فقط جدول‌های «ضروری» را منتقل می‌کند:

    families → members → accounts → custom_categories → subcategories → category_budgets

تراکنش‌ها، عکس‌ها، پیامک‌ها، پل‌ها، رویدادها و نشست‌ها **منتقل نمی‌شوند** و از صفر شروع
می‌شوند (تصمیمِ مالک: «فقط ضروری» + «شروع تمیزِ فایل‌ها»).

به‌علاوه، جدولِ مرجعِ ساکنِ `card_bins` (نگاشتِ BIN → نامِ بانک؛ دادهٔ کاربر نیست) به‌صورتِ
پیش‌فرض منتقل می‌شود تا شماره‌کارت‌ها در اپ به نامِ بانک نگاشت شوند؛ با `--skip-reference`
می‌توان صرفِ نظر کرد.

اصولِ ثابتِ این مهاجرت:
  • ستون‌های حمل‌شونده = «ستون‌های تارگت ∩ ستون‌های سورس» منهایِ EXCLUDE.
    این یعنی هر ستونی که در اسکیمای جدید نیست (یا در سورس نیست) خودبه‌خود کنار می‌رود
    و ستون‌های تازهٔ تارگت مقدارِ پیش‌فرضِ خود را می‌گیرند — بدون شکستن با drift اسکیما.
  • national_id هرگز منتقل نمی‌شود (PII، حذف‌شده از کل برنامه).
  • members.avatar_url اجباراً NULL می‌شود (فایل‌ها از صفر؛ لینک‌های قدیمیِ استوریج بی‌اعتبارند).
  • password_hash و phone باید در سورس باشند وگرنه مهاجرت متوقف می‌شود (ورود بدون آن‌ها می‌شکند؛
    بک‌اندِ جدید هش‌های قدیمی را هنگام ورودِ موفق به Argon2id ارتقا می‌دهد).
  • ترتیبِ بار رعایتِ کلیدهای خارجی را تضمین می‌کند و همه در «یک تراکنش» انجام می‌شود.

نکتهٔ حیاتیِ RLS: جدول‌های accounts/subcategories/custom_categories/category_budgets در
مهاجرتِ 0002 با FORCE RLS بسته می‌شوند و آن‌گاه حتی مالکِ جدول هم بدون زمینهٔ خانواده
نمی‌تواند بنویسد. پس این اسکریپت باید «پیش از» 0002 اجرا شود:
    alembic upgrade 0001  →  این اسکریپت  →  alembic upgrade head
اسکریپت خودش این را بررسی می‌کند و اگر RLS از قبل روی تارگت فعال باشد، با پیام توقف می‌کند.

اجرا:
    export SOURCE_DATABASE_URL='postgresql://…supabase…'      # فقط-خواندن از آن
    export TARGET_DATABASE_URL='postgresql://…postgres جدید…'  # (یا از DATABASE_URL خوانده می‌شود)
    python backend/migration/migrate_essentials.py --dry-run   # پیش‌نمایش، بدون نوشتن
    python backend/migration/migrate_essentials.py             # اجرای واقعی (یک تراکنش)

اسرار هرگز چاپ نمی‌شوند؛ فقط نامِ جدول و شمارشِ ردیف.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Iterable

try:
    import psycopg
    from psycopg import sql
except ModuleNotFoundError:  # pragma: no cover - راهنمای نصب
    sys.stderr.write(
        "psycopg (v3) نصب نیست. این اسکریپت را از داخلِ venv بک‌اند اجرا کنید:\n"
        "    cd backend && pip install -e \".[dev]\"\n"
    )
    raise SystemExit(2)


# ── پیکربندیِ ثابتِ مهاجرت ────────────────────────────────────────────────────

#: جدول‌های ضروری به ترتیبِ امنِ کلیدِ خارجی (والد پیش از فرزند).
ESSENTIAL_TABLES: tuple[str, ...] = (
    "families",          # ریشه
    "members",           # FK → families
    "accounts",          # FK → families, members
    "custom_categories",  # FK → families
    "subcategories",     # FK → families
    "category_budgets",  # FK → families
)

#: جدول‌های مرجعِ ساکنِ سراسری (نه دادهٔ کاربر، نه خانواده‌محور، بیرون از RLS). با
#: --skip-reference می‌توان صرفِ نظر کرد. 0001 جدول را می‌سازد ولی ردیف نمی‌ریزد؛ بدونِ
#: این‌ها شماره‌کارت‌ها در اپ به نامِ بانک نگاشت نمی‌شوند.
REFERENCE_TABLES: tuple[str, ...] = (
    "card_bins",  # BIN شش‌رقمی → نامِ بانک (کلیدِ اصلی: bin، نه id)
)

#: ستونِ تشخیصِ تکرار برای ON CONFLICT (پیش‌فرض id؛ استثناها این‌جا).
CONFLICT_KEY: dict[str, str] = {"card_bins": "bin"}

#: ستون‌هایی که هرگز منتقل نمی‌شوند (سراسری روی همهٔ جدول‌ها).
EXCLUDE_COLUMNS: frozenset[str] = frozenset({"national_id"})

#: (جدول، ستون)هایی که حمل می‌شوند ولی مقدارشان اجباراً NULL می‌شود.
FORCE_NULL: frozenset[tuple[str, str]] = frozenset({("members", "avatar_url")})

#: ستون‌هایی که «باید» در سورس باشند وگرنه مهاجرت متوقف می‌شود (ورود به آن‌ها وابسته است).
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


def get_urls() -> tuple[str, str]:
    source = os.environ.get("SOURCE_DATABASE_URL", "").strip()
    target = (os.environ.get("TARGET_DATABASE_URL")
              or os.environ.get("DATABASE_URL") or "").strip()
    missing = []
    if not source:
        missing.append("SOURCE_DATABASE_URL")
    if not target:
        missing.append("TARGET_DATABASE_URL (یا DATABASE_URL)")
    if missing:
        raise SystemExit(
            "متغیرهای محیطیِ لازم ست نشده‌اند: " + "، ".join(missing) + "\n"
            "نمونه:\n"
            "    export SOURCE_DATABASE_URL='postgresql://…'\n"
            "    export TARGET_DATABASE_URL='postgresql://…'\n"
        )
    return normalize_url(source), normalize_url(target)


def table_columns(conn: "psycopg.Connection", table: str) -> list[str]:
    """نامِ ستون‌های جدول به ترتیبِ ordinal (از information_schema)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            ORDER BY ordinal_position
            """,
            (table,),
        )
        return [r[0] for r in cur.fetchall()]


def table_exists(conn: "psycopg.Connection", table: str) -> bool:
    return bool(table_columns(conn, table))


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


def carry_columns(target_cols: list[str], source_cols: set[str]) -> list[str]:
    """ستون‌های حمل‌شونده: در تارگت هست، در سورس هم هست، و در EXCLUDE نیست (ترتیبِ تارگت حفظ می‌شود)."""
    return [c for c in target_cols if c in source_cols and c not in EXCLUDE_COLUMNS]


# ── منطقِ اصلی ────────────────────────────────────────────────────────────────

def plan_table(src: "psycopg.Connection", tgt: "psycopg.Connection", table: str) -> dict:
    """نقشهٔ مهاجرتِ یک جدول را می‌سازد و اعتبارسنجی می‌کند (بدونِ نوشتن)."""
    if not table_exists(tgt, table):
        raise SystemExit(f"جدولِ تارگت وجود ندارد: {table} — آیا «alembic upgrade 0001» اجرا شده؟")
    if not table_exists(src, table):
        # جدولِ ضروری در سورس نیست → با صفر ردیف رد می‌شویم (سناریوی بعید).
        return {"table": table, "carry": [], "source_rows": 0, "missing_source": True}

    tgt_cols = table_columns(tgt, table)
    src_cols = set(table_columns(src, table))

    required = REQUIRED_SOURCE_COLUMNS.get(table, frozenset())
    absent = sorted(required - src_cols)
    if absent:
        raise SystemExit(
            f"ستون‌های حیاتی در سورسِ «{table}» نیستند: {absent}. "
            "بدونِ این‌ها مهاجرت متوقف شد (ورود می‌شکند)."
        )

    carry = carry_columns(tgt_cols, src_cols)
    pk = CONFLICT_KEY.get(table, "id")
    if pk not in carry:
        raise SystemExit(f"کلیدِ «{pk}» برای «{table}» قابلِ حمل نیست؛ مهاجرت امن نیست.")

    return {
        "table": table,
        "carry": carry,
        "nulled": sorted(c for c in carry if (table, c) in FORCE_NULL),
        "dropped_present_in_source": sorted(
            c for c in src_cols if c in EXCLUDE_COLUMNS
        ),
        "source_rows": count_rows(src, table),
        "missing_source": False,
    }


def copy_table(src: "psycopg.Connection", tgt: "psycopg.Connection", plan: dict) -> int:
    """ردیف‌های یک جدول را با ستون‌های نقشه منتقل می‌کند. تعدادِ درج‌شده را برمی‌گرداند."""
    table, carry = plan["table"], plan["carry"]
    if plan["missing_source"] or not carry:
        return 0

    null_idx = {i for i, c in enumerate(carry) if (table, c) in FORCE_NULL}

    select_sql = sql.SQL("SELECT {cols} FROM public.{tbl}").format(
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in carry),
        tbl=sql.Identifier(table),
    )
    insert_sql = sql.SQL(
        "INSERT INTO public.{tbl} ({cols}) VALUES ({ph}) ON CONFLICT ({pk}) DO NOTHING"
    ).format(
        tbl=sql.Identifier(table),
        cols=sql.SQL(", ").join(sql.Identifier(c) for c in carry),
        ph=sql.SQL(", ").join(sql.Placeholder() * len(carry)),
        pk=sql.Identifier(CONFLICT_KEY.get(table, "id")),
    )

    inserted = 0
    with src.cursor() as rcur, tgt.cursor() as wcur:
        rcur.execute(select_sql)
        while True:
            rows = rcur.fetchmany(BATCH)
            if not rows:
                break
            if null_idx:
                rows = [
                    tuple(None if i in null_idx else v for i, v in enumerate(row))
                    for row in rows
                ]
            wcur.executemany(insert_sql, rows)
            inserted += len(rows)
    return inserted


def main() -> int:
    ap = argparse.ArgumentParser(description="مهاجرتِ دادهٔ «فقط ضروری» (فاز ۱۰).")
    ap.add_argument("--dry-run", action="store_true",
                    help="فقط پیش‌نمایش و شمارش؛ هیچ نوشتنی روی تارگت انجام نمی‌شود.")
    ap.add_argument("--truncate", action="store_true",
                    help="پیش از بار، جدول‌های ضروریِ تارگت را خالی می‌کند (برای اجرای دوبارهٔ تمیز).")
    ap.add_argument("--skip-reference", action="store_true",
                    help="جدول‌های مرجعِ ساکن (card_bins) را منتقل نکن.")
    args = ap.parse_args()

    source_url, target_url = get_urls()

    load_tables = ESSENTIAL_TABLES + (() if args.skip_reference else REFERENCE_TABLES)

    print("در حالِ اتصال به سورس و تارگت…")
    with psycopg.connect(source_url) as src, psycopg.connect(target_url) as tgt:
        src.autocommit = True  # فقط-خواندن
        tgt.autocommit = False  # همه‌چیز در یک تراکنش

        # نگهبانِ ترتیبِ RLS: اگر جدول‌های محافظت‌شده روی تارگت FORCE RLS دارند، یعنی 0002
        # اجرا شده و بارِ داده به‌عنوان مالک بسته می‌شود. (در dry-run فقط هشدار، چون نوشتنی نیست.)
        forced = rls_forced_tables(tgt, RLS_GUARDED_ESSENTIALS)
        if forced:
            msg = (
                "RLS روی تارگت از قبل فعال است: " + "، ".join(sorted(forced)) + "\n"
                "دادهٔ ضروری باید «پیش از» مهاجرتِ 0002 بار شود. لطفاً:\n"
                "    alembic downgrade 0001   (یا از ابتدا: upgrade 0001)\n"
                "سپس این اسکریپت را دوباره اجرا کنید و بعد: alembic upgrade head\n"
            )
            if not args.dry_run:
                raise SystemExit(msg)
            print("\n⚠ هشدار (dry-run): " + msg)

        # نقشهٔ هر جدول (اعتبارسنجیِ ستون‌ها).
        plans = [plan_table(src, tgt, t) for t in load_tables]

        print("\n── نقشهٔ مهاجرت ─────────────────────────────")
        for p in plans:
            tag = "  [مرجع]" if p["table"] in REFERENCE_TABLES else ""
            if p["missing_source"]:
                print(f"  {p['table']:<18} (در سورس نیست — رد شد){tag}")
                continue
            print(f"  {p['table']:<18} ردیفِ سورس={p['source_rows']:>6}  ستون‌ها={len(p['carry'])}{tag}")
            if p["dropped_present_in_source"]:
                print(f"      ⊘ کنارگذاشته: {', '.join(p['dropped_present_in_source'])}")
            if p["nulled"]:
                print(f"      ∅ اجباراً NULL: {', '.join(p['nulled'])}")

        if args.skip_reference:
            print("\n  دادهٔ مرجع رد شد (--skip-reference): " + "، ".join(REFERENCE_TABLES))

        print("\n  جدول‌هایی که از صفر شروع می‌شوند (منتقل نمی‌شوند):")
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
                n = copy_table(src, tgt, p)
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
            print(f"  {mark} {p['table']:<18} سورس={src_n:>6}  تارگت={tgt_n:>6}")

        print(f"\nمجموعِ ردیفِ درج‌شده: {total}")
        print("انجام شد ✓" if ok else "هشدار: شمارشِ برخی جدول‌ها کمتر از سورس است — بررسی کنید.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
