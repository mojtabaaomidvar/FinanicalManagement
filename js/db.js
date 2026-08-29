/* ═══════════════════════════════════════════════
   لایه دیتابیس — Supabase (PostgREST)
   بدون SDK — fetch خالص روی REST API
   نسخه ۳ — ورود با موبایل + رمز + OTP پیامکی
   ═══════════════════════════════════════════════ */

const DB = (() => {
  const BASE = SUPABASE_CONFIG.url.replace(/\/$/, "");
  const KEY = SUPABASE_CONFIG.anonKey;
  const REST = BASE + "/rest/v1";
  const RPC = BASE + "/rest/v1/rpc";

  const LS_SESSION =
    "pfa_session_v3"; /* { memberId, memberName, familyId, familyName, phone, role } */

  /* ── درخواست پایه ── */
  async function req(path, { method = "GET", body, query = "" } = {}) {
    const res = await fetch(REST + path + query, {
      method,
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
        Prefer: method === "POST" ? "return=representation" : "return=minimal",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      let msg = "خطای ارتباط با سرور (" + res.status + ")";
      try {
        const err = await res.json();
        if (err.message) msg = err.message;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    if (method === "GET" || method === "POST") {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
    return null;
  }

  /* ── فراخوانی تابع RPC ── */
  async function rpc(fnName, params) {
    const res = await fetch(RPC + "/" + fnName, {
      method: "POST",
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params || {}),
    });

    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* ignore */
    }

    if (!res.ok) {
      /* کد خطای داخل پیام Supabase را استخراج کن */
      const msg = data?.message || text || "";
      if (/OTP_API_ONLY/.test(msg)) {
        throw new Error("OTP_API_ONLY");
      }
      if (/TOO_SOON/.test(msg)) {
        throw new Error("TOO_SOON");
      }
      if (/PHONE_EXISTS/.test(msg)) {
        throw new Error("این شماره قبلاً ثبت‌نام کرده است");
      }
      if (/INVALID_OTP/.test(msg)) {
        throw new Error("کد وارد شده صحیح نیست یا منقضی شده");
      }
      if (/INVALID_INVITE/.test(msg)) {
        throw new Error("لینک دعوت نامعتبر یا منقضی شده است");
      }
      if (/NO_MEMBER/.test(msg)) {
        throw new Error("کاربری با این شماره یافت نشد");
      }
      throw new Error(msg || "خطا در ارتباط با سرور (" + res.status + ")");
    }
    return data;
  }

  const enc = encodeURIComponent;

  /* ═══════════════════════════════════════════
     نشست (session)
     ═══════════════════════════════════════════ */

  function getSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(s) {
    localStorage.setItem(LS_SESSION, JSON.stringify(s));
  }

  function clearSession() {
    localStorage.removeItem(LS_SESSION);
  }

  /* ═══════════════════════════════════════════
     احراز هویت — موبایل + رمز + OTP
     ═══════════════════════════════════════════ */

  /* هش رمز: SHA-256(phone:password) — هگز */
  async function hashPassword(phone, password) {
    const data = new TextEncoder().encode(phone + ":" + password);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /* نرمال‌سازی شماره ایرانی → 09xxxxxxxxx */
  function normalizePhone(p) {
    if (!p) return "";
    let s = String(p).replace(/[^\d+]/g, "");
    if (s.startsWith("+98")) s = "0" + s.slice(3);
    else if (s.startsWith("0098")) s = "0" + s.slice(4);
    else if (s.startsWith("98") && s.length === 12) s = "0" + s.slice(2);
    return /^09\d{9}$/.test(s) ? s : "";
  }

  /* درخواست کد OTP — اول تابع سرورless، بعد RPC حالت توسعه */
  async function requestOtp(phone) {
    /* ۱) تلاش برای /api/send-otp (Vercel) */
    try {
      const res = await fetch("api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        return { sent: true, devCode: data.devCode || null };
      }
      if (res.status === 429 || /TOO_SOON/.test(data.error || "")) {
        throw new Error("TOO_SOON");
      }
      /* خطای دیگر → ادامه به روش دوم */
    } catch (e) {
      if (/TOO_SOON/.test(e.message)) throw e;
      /* شبکه/۴۰۴ → ادامه به روش دوم */
    }

    /* ۲) RPC حالت توسعه (dev_mode در دیتابیس) */
    const code = await rpc("request_otp_dev", { p_phone: phone });
    return { sent: true, devCode: code || null };
  }

  /* مرحله ۱ ورود: بررسی شماره + رمز */
  async function checkPassword(phone, password) {
    const hash = await hashPassword(phone, password);
    return rpc("auth_check_password", {
      p_phone: phone,
      p_password_hash: hash,
    });
  }

  /* مرحله ۲ ورود: تأیید OTP → عضو + خانواده */
  async function loginWithOtp(phone, code) {
    return rpc("auth_login", { p_phone: phone, p_code: code });
  }

  /* ثبت‌نام (بعد از تأیید OTP) */
  async function register(familyName, memberName, phone, password) {
    const hash = await hashPassword(phone, password);
    return rpc("auth_register", {
      p_family_name: familyName,
      p_member_name: memberName,
      p_phone: phone,
      p_password_hash: hash,
    });
  }

  /* ═══════════════════════════════════════════
     دعوت اعضا — لینک + QR
     ═══════════════════════════════════════════ */

  async function createInvite(familyId) {
    return rpc("create_invite", { p_family_id: familyId });
  }

  async function getInvite(token) {
    return rpc("get_invite", { p_token: token });
  }

  async function acceptInvite(token, memberName, phone, password) {
    const hash = await hashPassword(phone, password);
    return rpc("accept_invite", {
      p_token: token,
      p_member_name: memberName,
      p_phone: phone,
      p_password_hash: hash,
    });
  }

  /* ═══════════════════════════════════════════
     خانواده‌ها و اعضا
     ═══════════════════════════════════════════ */

  async function getFamilyById(familyId) {
    const rows = await req("/families", {
      query: "?select=*&id=eq." + enc(familyId),
    });
    return rows[0] || null;
  }

  async function getMembers(familyId) {
    return req("/members", {
      query:
        "?select=id,name,role,phone,created_at&family_id=eq." +
        enc(familyId) +
        "&order=created_at.asc",
    });
  }

  async function deleteMember(memberId) {
    return req("/members", {
      method: "DELETE",
      query: "?id=eq." + enc(memberId),
    });
  }

  /* ═══════════════════════════════════════════
     تراکنش‌ها
     ═══════════════════════════════════════════ */

  async function getTransactions(familyId) {
    return req("/transactions", {
      query:
        "?select=*&family_id=eq." + enc(familyId) + "&order=created_at.desc",
    });
  }

  async function addTx(familyId, memberId, tx) {
    const [row] = await req("/transactions", {
      method: "POST",
      body: {
        family_id: familyId,
        member_id: memberId,
        type: tx.type,
        amount: tx.amount,
        category: tx.cat,
        date: tx.date /* 'YYYY-MM-DD' میلادی */,
        note: tx.note || null,
      },
    });
    return row;
  }

  async function updateTx(id, patch) {
    return req("/transactions", {
      method: "PATCH",
      query: "?id=eq." + enc(id),
      body: patch,
    });
  }

  async function deleteTx(id) {
    return req("/transactions", {
      method: "DELETE",
      query: "?id=eq." + enc(id),
    });
  }

  /* ═══════════════════════════════════════════
     پیامک‌های بانکی
     ═══════════════════════════════════════════ */

  async function getSms(familyId, status = null) {
    let q =
      "?select=*&family_id=eq." + enc(familyId) + "&order=created_at.desc";
    if (status) q += "&status=eq." + status;
    return req("/sms_messages", { query: q });
  }

  async function addSms(familyId, memberId, sms) {
    const [row] = await req("/sms_messages", {
      method: "POST",
      body: {
        family_id: familyId,
        member_id: memberId,
        raw_text: sms.rawText,
        bank: sms.bank || null,
        type: sms.type || null,
        amount: sms.amount || null,
        balance: sms.balance || null,
        date: sms.date || null,
        status: "pending",
      },
    });
    return row;
  }

  async function updateSms(id, patch) {
    return req("/sms_messages", {
      method: "PATCH",
      query: "?id=eq." + enc(id),
      body: patch,
    });
  }

  /* ═══════════════════════════════════════════
     تنظیمات (بر اساس خانواده)
     ═══════════════════════════════════════════ */

  async function getFamilySettings(familyId) {
    const rows = await req("/families", {
      query: "?select=*&id=eq." + enc(familyId),
    });
    const f = rows[0];
    return {
      budget: f?.budget ?? 0,
      currency: f?.currency ?? "تومان",
      dark: f?.dark ?? true,
    };
  }

  async function saveFamilySettings(familyId, s) {
    return req("/families", {
      method: "PATCH",
      query: "?id=eq." + enc(familyId),
      body: {
        budget: s.budget,
        currency: s.currency,
        dark: s.dark,
      },
    });
  }

  return {
    getSession,
    setSession,
    clearSession,

    /* auth */
    hashPassword,
    normalizePhone,
    requestOtp,
    checkPassword,
    loginWithOtp,
    register,

    /* invite */
    createInvite,
    getInvite,
    acceptInvite,

    /* data */
    getFamilyById,
    getMembers,
    deleteMember,
    getTransactions,
    addTx,
    updateTx,
    deleteTx,
    getSms,
    addSms,
    updateSms,
    getFamilySettings,
    saveFamilySettings,
  };
})();
