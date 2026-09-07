/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — پروکسی RPC ساپابیس
   فایل: api/rpc.js
   متد: POST { fn: "list_transactions", params: { p_token: "..." } }

   چرا: دامنه‌های *.supabase.co در سطح شبکه از ایران مسدودند؛
   مرورگر به دامنه‌ی خود اپ وصل می‌شود و این تابع (خارج از ایران)
   درخواست را به Supabase می‌برد — همان الگوی api/send-otp.

   امنیت: کلید publishable/anon عمومی است و همه‌ی کنترل دسترسی
   در خود RPCها با p_token انجام می‌شود (RLS بسته). علاوه بر آن این
   پروکسی فقط توابع فهرست ALLOWED را عبور می‌دهد — الگوی regex کافی
   نبود چون هر تابع موجود در پروژه (از جمله توابع داخلی «_») را مجاز
   می‌کرد. لایه‌ی دوم در خود دیتابیس است (revoke execute در انتهای schema.sql).

   متغیرهای محیطی (Vercel):
     SUPABASE_URL         آدرس پروژه
     SUPABASE_ANON_KEY    کلید publishable (یا SERVICE_KEY به‌عنوان جایگزین)
     ALLOWED_ORIGIN       دامنه‌ی مجاز CORS (اختیاری — پیش‌فرض: همه)
   ═══════════════════════════════════════════════ */

/* فهرست سفید توابع RPC — فقط این نام‌ها به Supabase می‌روند.
   هر تابع جدیدی که کلاینت صدا می‌زند باید اینجا هم اضافه شود. */
const ALLOWED = new Set([
  /* احراز هویت و نشست */
  "get_public_config",
  "check_pre_registered",
  "auth_check_password",
  "auth_login",
  "auth_register",
  "accept_invite",
  "get_invite",
  "create_invite",
  "validate_session",
  "logout_session",
  "logout_all_sessions",
  "change_password",
  /* خانواده و اعضا */
  "get_family",
  "get_members",
  "update_family_settings",
  "remove_member",
  "update_member_profile",
  "add_member_by_manager",
  "set_member_theme",
  "set_member_currency",
  "set_member_relation",
  /* تراکنش‌ها */
  "list_transactions",
  "add_transaction",
  "update_transaction",
  "delete_transaction",
  "mark_recurring_occurrence",
  "add_tx_photo",
  "update_tx_photo_caption",
  "delete_tx_photo",
  /* حساب‌ها */
  "list_accounts",
  "add_account",
  "update_account",
  "delete_account",
  /* دسته‌ها و زیردسته‌ها */
  "list_custom_categories",
  "add_custom_category",
  "delete_custom_category",
  "list_subcategories",
  "add_subcategory",
  "delete_subcategory",
  /* بودجه دسته‌ها */
  "list_category_budgets",
  "set_category_budget",
  "delete_category_budget",
  /* رویدادها */
  "list_events",
  "add_event",
  "delete_event",
  "sync_birthday_events",
  /* پیامک */
  "list_sms",
  "add_sms_messages",
  "set_sms_status",
  "get_bridge",
  "create_bridge",
]);

const CORS = {
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }

  const body = await readBody(req);
  const fn = String(body.fn ?? "");
  if (!ALLOWED.has(fn)) {
    return json(res, 400, { error: "INVALID_FN" });
  }

  const params =
    body.params && typeof body.params === "object" && !Array.isArray(body.params)
      ? body.params
      : {};

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(res, 500, {
      error: "SERVER_NOT_CONFIGURED",
      hint: "SUPABASE_URL و SUPABASE_ANON_KEY (یا SERVICE_KEY) را در Environment Variables تنظیم کنید",
    });
  }

  const url = `${SB_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`;
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    /* شبکه خروجی (مثلاً اجرای محلی بدون VPN در ایران) */
    console.error("rpc proxy fetch failed:", e?.message);
    return json(res, 502, { error: "UPSTREAM_UNREACHABLE" });
  }

  const text = await r.text();
  const ct = r.headers.get("content-type") || "application/json";
  res.writeHead(r.status, { ...CORS, "Content-Type": ct });
  return res.end(text);
};

/* ═══════════════ ابزارها ═══════════════ */

function json(res, status, data) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(d || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}
