/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — تبدیل کارت به شبا/حساب (best-effort)
   فایل: api/card-convert.js
   متد: POST { card }

   از سرویس‌های عمومی رایگان تبدیل کارت به حساب استفاده می‌کند؛
   این سرویس‌ها گاهی قطع یا محدود جغرافیایی هستند → در صورت عدم
   دسترسی { ok:false } برمی‌گردد و کلاینت پیام مناسبی نشان می‌دهد.
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
    return json(res, 405, { ok: false, error: "METHOD_NOT_ALLOWED" });
  }

  const body = await readBody(req);
  const card = String(body.card || "").replace(/\D/g, "");
  if (!/^\d{16}$/.test(card)) {
    return json(res, 400, { ok: false, error: "INVALID_CARD" });
  }

  /* سرویس‌های کاندید — اولی که جواب معتبر بدهد برنده است */
  const providers = [
    {
      url: `https://api.codebazan.ir/cardtoaccount/?card=${card}`,
      pick: (d) => ({
        sheba: typeof d.sheba === "string" ? d.sheba : null,
        account: typeof d.account === "string" ? d.account : typeof d.hesab === "string" ? d.hesab : null,
        bank: typeof d.bank === "string" ? d.bank : null,
      }),
    },
    {
      url: `https://api.codebazan.ir/cardinfo/?card=${card}`,
      pick: (d) => ({
        sheba: null,
        account: null,
        bank: typeof d.bank === "string" ? d.bank : null,
      }),
    },
  ];

  for (const p of providers) {
    try {
      const r = await fetchWithTimeout(p.url, 6000);
      if (!r.ok) continue;
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      if (!data || typeof data !== "object") continue;

      const picked = p.pick(data);
      if (picked.sheba || picked.account || picked.bank) {
        return json(res, 200, {
          ok: true,
          sheba: cleanSheba(picked.sheba),
          account: picked.account ? picked.account.replace(/\D/g, "") || null : null,
          bank: picked.bank || null,
        });
      }
    } catch {
      /* سرویس بعدی */
    }
  }

  return json(res, 200, {
    ok: false,
    error: "SERVICE_UNAVAILABLE",
    message: "سرویس تبدیل آنلاین در دسترس نیست — شبا/حساب را دستی وارد کنید",
  });
};

/* ═══════════════ ابزارها ═══════════════ */

function cleanSheba(raw) {
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/[^0-9A-Z]/g, "");
  return /^IR\d{24}$/.test(s) ? s : null;
}

function fetchWithTimeout(url, ms) {
  return Promise.race([
    fetch(url, { headers: { Accept: "application/json" } }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

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
