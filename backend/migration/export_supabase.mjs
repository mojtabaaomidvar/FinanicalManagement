#!/usr/bin/env node
// ── اکسپورتِ جدول‌های «ضروری» از Supabase به فایل‌های JSON — بدونِ هیچ وابستگی ──
//
// چرا؟ در شبکهٔ ایران نصبِ psycopg و اتصالِ مستقیمِ Postgres روی لپ‌تاپ دشوار بود؛ اما
// همان راهی که اپ با آن به Supabase وصل می‌شد (HTTPS به PostgREST) از لپ‌تاپ کار می‌کند.
// این اسکریپت فقط از fetchِ داخلیِ Node استفاده می‌کند (Node ≥ ۱۸) — نیازی به نصبِ چیزی نیست.
//
// اجرا (روی لپ‌تاپ، از ریشهٔ پروژه):
//     $env:SUPABASE_URL = 'https://<ref>.supabase.co'
//     $env:SUPABASE_SERVICE_ROLE_KEY = '<کلیدِ service_role از داشبورد>'
//     node backend/migration/export_supabase.mjs
//
// خروجی: backend/migration/export/<table>.json (آرایهٔ ردیف‌ها).
//
// نکتهٔ حریمِ خصوصی: ستونِ national_id پیش از نوشتن حذف می‌شود (روی دیسک نمی‌نشیند).
// نکتهٔ امنیت: کلیدِ service_role بسیار حساس است (کلِ دیتابیس را می‌خواند)؛ آن را فقط در
// متغیرِ محیطی بگذار و هرگز در گیت یا فایل commit نکن.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// جدول‌های ضروری (ترتیب اینجا مهم نیست؛ ترتیبِ FK را ایمپورتر رعایت می‌کند).
const ESSENTIAL_TABLES = [
  "families", "members", "accounts",
  "custom_categories", "subcategories", "category_budgets",
];
const REFERENCE_TABLES = ["card_bins"];
const CONFLICT_KEY = { card_bins: "bin" }; // ستونِ مرتب‌سازی برای صفحه‌بندیِ پایدار
const DROP_COLUMNS = ["national_id"];       // هرگز روی دیسک نوشته نشود (PII)
const PAGE = 1000;

function die(msg) {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

if (typeof fetch !== "function") {
  die("این اسکریپت به fetchِ داخلیِ Node نیاز دارد (Node ≥ ۱۸). نسخه را با «node --version» ببین.");
}

const RAW_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!RAW_URL || !KEY) {
  die(
    "متغیرهای لازم ست نشده‌اند:\n" +
    "    SUPABASE_URL=https://<ref>.supabase.co\n" +
    "    SUPABASE_SERVICE_ROLE_KEY=<کلیدِ service_role>\n" +
    "(هر دو از داشبوردِ Supabase → Settings → API؛ کلیدِ service_role، نه anon)"
  );
}
const REST = RAW_URL.endsWith("/rest/v1") ? RAW_URL : RAW_URL + "/rest/v1";

const HEADERS = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  Accept: "application/json",
};

// یک جدول را با صفحه‌بندی می‌خواند. isReference=true یعنی نبودنِ جدول (۴۰۴) کشنده نیست.
async function fetchTable(table, isReference) {
  const order = CONFLICT_KEY[table] || "id";
  const rows = [];
  let offset = 0;
  let droppedAny = false;

  for (;;) {
    const url =
      `${REST}/${encodeURIComponent(table)}` +
      `?select=*&order=${encodeURIComponent(order)}.asc&limit=${PAGE}&offset=${offset}`;

    let res;
    try {
      res = await fetch(url, { headers: HEADERS });
    } catch (e) {
      die(`اتصال به Supabase برای «${table}» شکست خورد (شبکه/VPN؟): ${e.message}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 404 && isReference) {
        process.stderr.write(
          `  ⚠ «${table}» در Supabase نبود (۴۰۴) — رد شد؛ فایلِ خالی نوشته می‌شود.\n`
        );
        return { rows: [], dropped: false };
      }
      die(
        `خطای HTTP ${res.status} برای «${table}». ` +
          (res.status === 401 || res.status === 403
            ? "کلیدِ service_role را بررسی کن (باید service_role باشد نه anon)."
            : res.status === 404
            ? "جدول در PostgREST دیده نشد (نامِ جدول یا schema)."
            : body.slice(0, 300))
      );
    }

    let page;
    try {
      page = await res.json();
    } catch (e) {
      die(`پاسخِ «${table}» JSONِ معتبر نبود: ${e.message}`);
    }
    if (!Array.isArray(page)) die(`پاسخِ غیرمنتظره برای «${table}» (آرایه نبود).`);
    if (page.length === 0) break;

    for (const r of page) {
      for (const c of DROP_COLUMNS) {
        if (c in r) {
          droppedAny = true;
          delete r[c];
        }
      }
      rows.push(r);
    }
    offset += page.length; // پیش‌رَوی بر اساسِ تعدادِ واقعیِ برگشتی (مقاوم به سقفِ سرور)
  }

  return { rows, dropped: droppedAny };
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = join(here, "export");
  mkdirSync(outDir, { recursive: true });

  const project = REST.replace(/\/rest\/v1$/, "");
  console.log("اکسپورت از:", project, "→", outDir);

  const tables = [
    ...ESSENTIAL_TABLES.map((t) => [t, false]),
    ...REFERENCE_TABLES.map((t) => [t, true]),
  ];

  let grand = 0;
  for (const [t, isRef] of tables) {
    const { rows, dropped } = await fetchTable(t, isRef);
    writeFileSync(join(outDir, `${t}.json`), JSON.stringify(rows), "utf-8");
    grand += rows.length;
    const note = dropped ? `  (حذف شد: ${DROP_COLUMNS.join(", ")})` : "";
    const tag = isRef ? "  [مرجع]" : "";
    console.log(`  ${t.padEnd(18)} ${String(rows.length).padStart(6)} ردیف → ${t}.json${tag}${note}`);
  }

  console.log(`\nمجموع: ${grand} ردیف در ${outDir}`);
  console.log("گامِ بعد: پوشهٔ export/ و import_essentials.py را به سرور scp کن (دستورش را می‌دهم).");
}

main();
