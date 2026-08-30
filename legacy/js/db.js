/* ═══════════════════════════════════════════════
   لایه دیتابیس — Supabase (PostgREST RPC)
   بدون SDK — fetch خالص روی REST API
   نسخه ۳.۱ — نشست با توکن؛ همه دسترسی‌ها از طریق RPC امن
   (هیچ جدولی مستقیماً از کلاینت خوانده/نوشته نمی‌شود)
   ═══════════════════════════════════════════════ */

const DB = (() => {
  const BASE = SUPABASE_CONFIG.url.replace(/\/$/, "");
  const KEY = SUPABASE_CONFIG.anonKey;
  const RPC = BASE + "/rest/v1/rpc";

  const LS_SESSION =
    "pfa_session_v4"; /* { memberId, memberName, familyId, familyName, phone, role, token } */

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
      if (/SESSION_EXPIRED/.test(msg)) {
        clearSession();
        throw new Error("نشست منقضی شده — لطفاً دوباره وارد شوید");
      }
      if (/OTP_API_ONLY/.test(msg)) {
        throw new Error("OTP_API_ONLY");
      }
      if (/TOO_SOON/.test(msg)) {
        throw new Error("TOO_SOON");
      }
      if (/TOO_MANY_ATTEMPTS/.test(msg)) {
        throw new Error("تلاش‌های ناموفق زیاد بوده — ۱۵ دقیقه بعد امتحان کنید");
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
      if (/INVALID_MEMBER/.test(msg)) {
        throw new Error("عضو انتخاب‌شده معتبر نیست");
      }
      if (/CANNOT_REMOVE_OWNER/.test(msg)) {
        throw new Error("مدیر خانواده قابل حذف نیست");
      }
      if (/FORBIDDEN/.test(msg)) {
        throw new Error("اجازه انجام این کار را ندارید");
      }
      if (/INVALID_(TYPE|AMOUNT|CATEGORY|DATE)/.test(msg)) {
        throw new Error("اطلاعات تراکنش معتبر نیست");
      }
      if (/NOT_FOUND/.test(msg)) {
        throw new Error("مورد یافت نشد");
      }
      throw new Error(msg || "خطا در ارتباط با سرور (" + res.status + ")");
    }
    return data;
  }

  /* ── توکن نشست فعلی ── */
  function tok() {
    return getSession()?.token || "";
  }

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

  /* مرحله ۲ ورود: تأیید OTP → عضو + خانواده + توکن نشست */
  async function loginWithOtp(phone, code) {
    return rpc("auth_login", { p_phone: phone, p_code: code });
  }

  /* ثبت‌نام — کد OTP در سرور اعتبارسنجی می‌شود */
  async function register(familyName, memberName, phone, password, otpCode) {
    const hash = await hashPassword(phone, password);
    return rpc("auth_register", {
      p_family_name: familyName,
      p_member_name: memberName,
      p_phone: phone,
      p_password_hash: hash,
      p_otp_code: otpCode,
    });
  }

  /* ═══════════════════════════════════════════
     دعوت اعضا — لینک + QR
     ═══════════════════════════════════════════ */

  async function createInvite() {
    return rpc("create_invite", { p_token: tok() });
  }

  async function getInvite(token) {
    return rpc("get_invite", { p_token: token });
  }

  /* پذیرش دعوت — کد OTP در سرور اعتبارسنجی می‌شود */
  async function acceptInvite(token, memberName, phone, password, otpCode) {
    const hash = await hashPassword(phone, password);
    return rpc("accept_invite", {
      p_token: token,
      p_member_name: memberName,
      p_phone: phone,
      p_password_hash: hash,
      p_otp_code: otpCode,
    });
  }

  /* ═══════════════════════════════════════════
     نشست: اعتبارسنجی و خروج
     ═══════════════════════════════════════════ */

  /* اعتبارسنجی توکن → { member, family, members } */
  async function validateSession(token) {
    return rpc("validate_session", { p_token: token });
  }

  /* خروج: حذف نشست از سرور + پاک‌سازی محلی */
  async function logout() {
    const token = tok();
    clearSession();
    if (token) {
      try {
        await rpc("logout_session", { p_token: token });
      } catch {
        /* بی‌صدا — نشست سمت سرور خودش منقضی می‌شود */
      }
    }
  }

  /* ═══════════════════════════════════════════
     خانواده‌ها و اعضا
     ═══════════════════════════════════════════ */

  async function getFamilyById() {
    return rpc("get_family", { p_token: tok() });
  }

  async function getMembers() {
    return rpc("get_members", { p_token: tok() });
  }

  async function deleteMember(memberId) {
    return rpc("remove_member", { p_token: tok(), p_member_id: memberId });
  }

  /* ═══════════════════════════════════════════
     تراکنش‌ها
     ═══════════════════════════════════════════ */

  async function getTransactions() {
    return rpc("list_transactions", { p_token: tok() });
  }

  /* tx: { type, amount, category, date: 'YYYY-MM-DD' میلادی, note } */
  async function addTx(familyId, memberId, tx) {
    return rpc("add_transaction", {
      p_token: tok(),
      p_member_id: memberId,
      p_type: tx.type,
      p_amount: tx.amount,
      p_category: tx.category,
      p_date: tx.date,
      p_note: tx.note || null,
    });
  }

  /* patch: { member_id, type, amount, category, date, note } */
  async function updateTx(id, patch) {
    return rpc("update_transaction", {
      p_token: tok(),
      p_tx_id: id,
      p_member_id: patch.member_id,
      p_type: patch.type,
      p_amount: patch.amount,
      p_category: patch.category,
      p_date: patch.date,
      p_note: patch.note || null,
    });
  }

  async function deleteTx(id) {
    return rpc("delete_transaction", { p_token: tok(), p_tx_id: id });
  }

  /* ═══════════════════════════════════════════
     پیامک‌های بانکی
     ═══════════════════════════════════════════ */

  async function getSms(familyId, status = null) {
    return rpc("list_sms", {
      p_token: tok(),
      p_status: status || null,
    });
  }

  /* افزودن دسته‌ای: [{ rawText, bank, type, amount, balance, date }] */
  async function addSmsBatch(items) {
    return rpc("add_sms_messages", {
      p_token: tok(),
      p_items: items.map((s) => ({
        raw_text: s.rawText,
        bank: s.bank || null,
        type: s.type || null,
        amount: s.amount ?? null,
        balance: s.balance ?? null,
        date: s.date || null,
      })),
    });
  }

  /* افزودن تکی (پایگاه سازگاری) */
  async function addSms(familyId, memberId, sms) {
    return addSmsBatch([sms]);
  }

  async function updateSms(id, patch) {
    return rpc("set_sms_status", {
      p_token: tok(),
      p_sms_id: id,
      p_status: patch.status,
    });
  }

  /* ═══════════════════════════════════════════
     تنظیمات (بر اساس خانواده)
     ═══════════════════════════════════════════ */

  async function getFamilySettings() {
    const f = await rpc("get_family", { p_token: tok() });
    return {
      budget: f?.budget ?? 0,
      currency: f?.currency ?? "تومان",
      dark: f?.dark ?? true,
    };
  }

  async function saveFamilySettings(familyId, s) {
    return rpc("update_family_settings", {
      p_token: tok(),
      p_budget: s.budget,
      p_currency: s.currency,
      p_dark: s.dark,
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

    /* session */
    validateSession,
    logout,

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
    addSmsBatch,
    updateSms,
    getFamilySettings,
    saveFamilySettings,
  };
})();
