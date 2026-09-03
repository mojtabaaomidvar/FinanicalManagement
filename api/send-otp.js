/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — ارسال کد تأیید (OTP) پیامکی
   فایل: api/send-otp.js
   متد: POST { phone: "09xxxxxxxxx" }

   متغیرهای محیطی (Vercel → Settings → Environment Variables):
   ─────────────────────────────────────────────
   SUPABASE_URL         آدرس پروژه Supabase
   SUPABASE_SERVICE_KEY کلید service_role (نمایش در Settings → API)
   SMS_PROVIDER         kavenegar | ghasedak | smsir   (اختیاری)
   KAVENEGAR_API_KEY    کلید کاوه‌نگار
   GHASEDAK_API_KEY     کلید قاصدک
   SMSIR_API_KEY        کلید SMS.ir

   اگر SMS_PROVIDER تنظیم نشده باشد → حالت توسعه:
   کد در پاسخ JSON برمی‌گردد (devCode) تا بدون پنل پیامکی تست کنید.
   ═══════════════════════════════════════════════ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async (req, res) => {
  /* CORS preflight */
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    return res.end();
  }
  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  /* ── ورودی ── */
  const body = await readBody(req);
  const phone = normalizePhone(body.phone);
  if (!phone) {
    return json(res, 400, { ok: false, error: "INVALID_PHONE" });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(res, 500, {
      ok: false,
      error: "SERVER_NOT_CONFIGURED",
      hint: "SUPABASE_URL و SUPABASE_SERVICE_KEY را در Environment Variables تنظیم کنید",
    });
  }

  try {
    /* ── Rate limit: حداکثر یک درخواست در ۶۰ ثانیه ── */
    const recent = await sbFetch(
      SB_URL,
      SB_KEY,
      `/rest/v1/otp_codes?select=id&phone=eq.${phone}&created_at=gte.${new Date(Date.now() - 60_000).toISOString()}`,
    );
    if (recent.length > 0) {
      return json(res, 429, { ok: false, error: "TOO_SOON" });
    }

    /* ── تولید و درج کد ── */
    const code = String(Math.floor(100000 + Math.random() * 900000));

    /* حذف کدهای قبلی + درج کد جدید */
    await sbFetch(
      SB_URL,
      SB_KEY,
      `/rest/v1/otp_codes?phone=eq.${phone}`,
      "DELETE",
    );
    await sbFetch(SB_URL, SB_KEY, "/rest/v1/otp_codes", "POST", {
      phone,
      code,
      expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    });

    /* ── ارسال پیامک ── */
    const provider = (process.env.SMS_PROVIDER || "").toLowerCase();
    const text = `مالی من\nکد تأیید شما: ${code}\nاعتبار 2 دقیقه`;

    if (provider === "kavenegar" && process.env.KAVENEGAR_API_KEY) {
      await sendKavenegar(process.env.KAVENEGAR_API_KEY, phone, code, text);
    } else if (provider === "ghasedak" && process.env.GHASEDAK_API_KEY) {
      await sendGhasedak(process.env.GHASEDAK_API_KEY, phone, text);
    } else if (provider === "smsir" && process.env.SMSIR_API_KEY) {
      await sendSmsIr(process.env.SMSIR_API_KEY, phone, text);
    } else {
      /* حالت توسعه — بدون پنل پیامکی */
      console.log(`[DEV OTP] ${phone}: ${code}`);
      return json(res, 200, {
        ok: true,
        dev: true,
        devCode: code,
        message: "حالت توسعه: کد در پاسخ برگشت (SMS_PROVIDER تنظیم نشده)",
      });
    }

    return json(res, 200, { ok: true });
  } catch (e) {
    console.error("send-otp error:", e.message);
    return json(res, 500, {
      ok: false,
      error: "SEND_FAILED",
      detail: e.message,
    });
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

/* نرمال‌سازی شماره ایرانی → 09xxxxxxxxx */
function normalizePhone(p) {
  if (!p) return null;
  let s = String(p).replace(/[^\d+]/g, "");
  if (s.startsWith("+98")) s = "0" + s.slice(3);
  else if (s.startsWith("0098")) s = "0" + s.slice(4);
  else if (s.startsWith("98") && s.length === 12) s = "0" + s.slice(2);
  return /^09\d{9}$/.test(s) ? s : null;
}

/* درخواست Supabase با کلید service_role */
async function sbFetch(url, key, path, method = "GET", body = null) {
  const res = await fetch(url + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
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

/* ── کاوه‌نگار (Verify Lookup) ── */
async function sendKavenegar(apiKey, phone, code, text) {
  /* استفاده از سرویس Template-less (ارسال ساده) */
  const url =
    `https://api.kavenegar.com/v1/${apiKey}/sms/send.json` +
    `?receptor=${encodeURIComponent(phone)}&message=${encodeURIComponent(text)}`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) throw new Error(`Kavenegar ${res.status}`);
}

/* ── قاصدک ── */
async function sendGhasedak(apiKey, phone, text) {
  const res = await fetch("https://api.ghasedak.me/v2/sms/send/simple", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `receptor=${phone}&message=${encodeURIComponent(text)}&linenumber=30005006`,
  });
  if (!res.ok) throw new Error(`Ghasedak ${res.status}`);
}

/* ── SMS.ir ── */
async function sendSmsIr(apiKey, phone, text) {
  const res = await fetch("https://api.sms.ir/v1/send/bulk", {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      lineNumber: "300074775" /* شماره خط خود را جایگزین کنید */,
      messageText: text,
      mobiles: [phone],
    }),
  });
  if (!res.ok) throw new Error(`SMS.ir ${res.status}`);
}
