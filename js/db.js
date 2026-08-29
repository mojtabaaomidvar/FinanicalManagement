/* ═══════════════════════════════════════════════
   لایه دیتابیس — Supabase (PostgREST)
   بدون SDK — fetch خالص روی REST API
   ═══════════════════════════════════════════════ */

const DB = (() => {
  const BASE = SUPABASE_CONFIG.url.replace(/\/$/, "");
  const KEY = SUPABASE_CONFIG.anonKey;
  const REST = BASE + "/rest/v1";

  const LS_SESSION =
    "pfa_session_v2"; /* { familyId, familyCode, memberId, memberName } */

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

  const enc = encodeURIComponent;

  /* ═══════════════════════════════════════════
     نشست (session) — ذخیره محلی انتخاب کاربر
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
     خانواده‌ها و اعضا
     ═══════════════════════════════════════════ */

  /* ساخت خانواده جدید + عضو اول (owner) */
  async function createFamily(familyName, ownerName) {
    /* تولید کد ۶ رقمی یکتا در کلاینت */
    let code,
      exists,
      guard = 0;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
      const rows = await req("/families", {
        query: "?select=id&code=eq." + code,
      });
      exists = rows.length > 0;
      guard++;
    } while (exists && guard < 20);
    if (exists) throw new Error("خطا در تولید کد خانواده، دوباره تلاش کنید");

    const [family] = await req("/families", {
      method: "POST",
      body: { name: familyName, code },
    });

    const [member] = await req("/members", {
      method: "POST",
      body: { family_id: family.id, name: ownerName, role: "owner" },
    });

    return { family, member };
  }

  /* ورود با کد خانواده */
  async function getFamilyByCode(code) {
    const rows = await req("/families", {
      query: "?select=*&code=eq." + enc(code),
    });
    return rows[0] || null;
  }

  async function getMembers(familyId) {
    return req("/members", {
      query:
        "?select=*&family_id=eq." + enc(familyId) + "&order=created_at.asc",
    });
  }

  async function addMember(familyId, name) {
    const [m] = await req("/members", {
      method: "POST",
      body: { family_id: familyId, name, role: "member" },
    });
    return m;
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
        date: sms.date || null /* 'YYYY-MM-DD' یا null */,
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
     تنظیمات (بر اساس خانواده — در جدول families)
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
    createFamily,
    getFamilyByCode,
    getMembers,
    addMember,
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
