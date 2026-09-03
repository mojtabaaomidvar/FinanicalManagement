/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — پروکسی RPC ساپابیس
   فایل: api/rpc.js
   متد: POST { fn: "list_transactions", params: { p_token: "..." } }

   چرا: دامنه‌های *.supabase.co در سطح شبکه از ایران مسدودند؛
   مرورگر به دامنه‌ی خود اپ وصل می‌شود و این تابع (خارج از ایران)
   درخواست را به Supabase می‌برد — همان الگوی api/send-otp.

   امنیت: کلید publishable/anon عمومی است و همه‌ی کنترل دسترسی
   در خود RPCها با p_token انجام می‌شود (RLS بسته) — پس این پروکسی
   چیزی از سطح امنیت مستقیم را پایین نمی‌آورد. نام تابع اعتبارسنجی
   می‌شود تا پروکسیِ باز به مسیرهای دلخواه نباشد.

   متغیرهای محیطی (Vercel):
     SUPABASE_URL         آدرس پروژه
     SUPABASE_ANON_KEY    کلید publishable (یا SERVICE_KEY به‌عنوان جایگزین)
   ═══════════════════════════════════════════════ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "POST") {
    return json(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }

  const body = await readBody(req);
  const fn = String(body.fn ?? "");
  if (!/^[a-z_][a-z0-9_]{0,63}$/i.test(fn)) {
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
  const r = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: "Bearer " + SB_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

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
