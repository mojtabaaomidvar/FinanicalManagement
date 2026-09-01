/* ═══════════════════════════════════════════════
   تابع سرورلس Vercel — آپلود عکس پروفایل (آواتار)
   فایل: api/upload-avatar.js
   متد: POST { token, image } — image = dataURL

   توکن نشست با کلید service اعتبارسنجی می‌شود،
   تصویر (حداکثر ~۱MB) در باکت عمومی avatars ذخیره
   و URL عمومی آن برگردانده می‌شود.
   متغیرها: SUPABASE_URL و SUPABASE_SERVICE_KEY
   ═══════════════════════════════════════════════ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BASE64 = 1_400_000; /* ~1MB تصویر */
const ALLOWED = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

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
  const image = typeof body.image === "string" ? body.image : "";

  if (!token || !image) {
    return json(res, 400, { ok: false, error: "INVALID_PAYLOAD" });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(res, 500, { ok: false, error: "SERVER_NOT_CONFIGURED" });
  }

  /* اعتبارسنجی توکن نشست */
  try {
    const sessions = await sbFetch(
      SB_URL,
      SB_KEY,
      `/rest/v1/sessions?select=member_id,expires_at&token=eq.${encodeURIComponent(token)}&limit=1`,
    );
    if (!sessions.length) {
      return json(res, 401, { ok: false, error: "INVALID_TOKEN" });
    }
    if (new Date(sessions[0].expires_at) <= new Date()) {
      return json(res, 401, { ok: false, error: "SESSION_EXPIRED" });
    }
    const memberId = sessions[0].member_id;

    /* تجزیه dataURL */
    const m = image.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) {
      return json(res, 400, { ok: false, error: "INVALID_IMAGE" });
    }
    const mime = m[1];
    if (m[2].length > MAX_BASE64) {
      return json(res, 400, { ok: false, error: "IMAGE_TOO_LARGE" });
    }
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length) {
      return json(res, 400, { ok: false, error: "INVALID_IMAGE" });
    }

    const ext = ALLOWED[mime];
    const path = `${memberId}-${Date.now()}.${ext}`;

    /* آپلود به Supabase Storage با service key */
    const up = await fetch(`${SB_URL}/storage/v1/object/avatars/${path}`, {
      method: "POST",
      headers: {
        apikey: SB_KEY,
        Authorization: "Bearer " + SB_KEY,
        "Content-Type": mime,
        "x-upsert": "true",
      },
      body: buf,
    });
    if (!up.ok) {
      const t = await up.text();
      throw new Error(`Storage ${up.status}: ${t.slice(0, 150)}`);
    }

    return json(res, 200, {
      ok: true,
      url: `${SB_URL}/storage/v1/object/public/avatars/${path}`,
    });
  } catch (e) {
    console.error("upload-avatar error:", e.message);
    return json(res, 500, { ok: false, error: "UPLOAD_FAILED" });
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

async function sbFetch(url, key, path) {
  const res = await fetch(url + path, {
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}
