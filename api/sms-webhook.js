/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — وب‌هوک پل پیامک (اندروید)
   فایل: api/sms-webhook.js
   متد: POST { token, text, sender? }

   اپ فوروارد پیامک (Tasker / MacroDroid / SMS Forwarder)
   روی گوشی اندرویدی، پیامک‌های بانکی را به این آدرس می‌فرستد؛
   پیامک با وضعیت pending برای خانواده-owner ثبت می‌شود و در
   مودال «پیامک‌های ثبت‌نشده» اپ ظاهر می‌گردد.

   متغیرهای محیطی (مانند send-otp):
   SUPABASE_URL و SUPABASE_SERVICE_KEY
   ═══════════════════════════════════════════════ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_TEXT_LENGTH = 2000;

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const body = await readBody(req);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sender = typeof body.sender === "string" ? body.sender.trim().slice(0, 32) : null;

  if (!token || !text) {
    return json(res, 400, { ok: false, error: "INVALID_PAYLOAD" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json(res, 400, { ok: false, error: "TEXT_TOO_LONG" });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(res, 500, { ok: false, error: "SERVER_NOT_CONFIGURED" });
  }

  try {
    /* یافتن پل فعال از روی کلید → خانواده + عضو */
    const bridges = await sbFetch(
      SB_URL,
      SB_KEY,
      `/rest/v1/sms_bridges?select=family_id,member_id&token=eq.${encodeURIComponent(token)}&active=eq.true&limit=1`,
    );
    if (!bridges.length) {
      return json(res, 401, { ok: false, error: "INVALID_TOKEN" });
    }
    const { family_id, member_id } = bridges[0];

    /* درج مستقیم با کلید service (دسترسی از RLS عبور می‌کند) */
    await sbFetch(SB_URL, SB_KEY, "/rest/v1/sms_messages", "POST", {
      family_id,
      member_id,
      raw_text: text,
      bank: sender,
      status: "pending",
    });

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("sms-webhook error:", e.message);
    return json(res, 500, { ok: false, error: "INSERT_FAILED" });
  }
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

async function sbFetch(url, key, path, method = "GET", body = null) {
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}
