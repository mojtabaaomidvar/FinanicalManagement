/* ═══════════════════════════════════════════════
   تست یکپارچگی — همه اسکریپت‌ها را با DOM ساختگی
   در یک اسکوپ مشترک بارگذاری و API ها را بررسی می‌کند
   اجرا: node tools/integration-test.js
   ═══════════════════════════════════════════════ */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

/* ── DOM ساختگی ── */
function makeEl() {
  const el = {
    style: {},
    dataset: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains() {
        return false;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    remove() {},
    focus() {},
    select() {},
    click() {},
    setAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector() {
      return makeEl();
    },
    querySelectorAll() {
      return [];
    },
    getContext() {
      return { fillRect() {}, set fillStyle(v) {} };
    },
    innerHTML: "",
    textContent: "",
    value: "",
    width: 0,
    height: 0,
  };
  return el;
}

const sandbox = {
  console,
  window: { devicePixelRatio: 2, addEventListener() {} },
  document: {
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    getElementById: () => makeEl(),
    createElement: () => makeEl(),
    addEventListener() {},
    documentElement: { dataset: {} },
    body: { style: {} },
  },
  navigator: { serviceWorker: undefined },
  localStorage: {
    _s: {},
    getItem(k) {
      return this._s[k] ?? null;
    },
    setItem(k, v) {
      this._s[k] = String(v);
    },
    removeItem(k) {
      delete this._s[k];
    },
  },
  location: {
    origin: "https://test.app",
    pathname: "/",
    search: "",
    reload() {},
  },
  URLSearchParams,
  fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  crypto: {
    subtle: {
      digest: async (alg, data) => {
        /* هش ساختگی برای تست */
        return new Uint8Array(32).fill(1);
      },
    },
  },
  TextEncoder,
  Blob: class {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
sandbox.window.localStorage = sandbox.localStorage;

vm.createContext(sandbox);

/* ── بارگذاری اسکریپت‌ها به ترتیب ── */
const ROOT = path.join(__dirname, "..");
const scripts = [
  "js/config.js",
  "js/jalali.js",
  "js/sms-parser.js",
  "js/qrcode.min.js",
  "js/db.js",
  "js/charts.js",
  "js/app.js",
];

for (const s of scripts) {
  const code = fs.readFileSync(path.join(ROOT, s), "utf8");
  try {
    vm.runInContext(code, sandbox, { filename: s });
    console.log("LOADED:", s);
  } catch (e) {
    console.error("FAILED:", s, "→", e.message);
    process.exit(1);
  }
}

/* ── استخراج متغیرهای سراسری (const در vm اسکوپ‌بسته است) ── */
const G = vm.runInContext("({ DB, SmsParser, Jalali, qrcode })", sandbox);

/* ── بررسی API ها ── */
const checks = [
  ["DB.getSession", () => typeof G.DB.getSession === "function"],
  ["DB.setSession", () => typeof G.DB.setSession === "function"],
  ["DB.clearSession", () => typeof G.DB.clearSession === "function"],
  ["DB.normalizePhone", () => typeof G.DB.normalizePhone === "function"],
  ["DB.hashPassword", () => typeof G.DB.hashPassword === "function"],
  ["DB.requestOtp", () => typeof G.DB.requestOtp === "function"],
  ["DB.checkPassword", () => typeof G.DB.checkPassword === "function"],
  ["DB.loginWithOtp", () => typeof G.DB.loginWithOtp === "function"],
  ["DB.register", () => typeof G.DB.register === "function"],
  ["DB.createInvite", () => typeof G.DB.createInvite === "function"],
  ["DB.getInvite", () => typeof G.DB.getInvite === "function"],
  ["DB.acceptInvite", () => typeof G.DB.acceptInvite === "function"],
  ["DB.getFamilyById", () => typeof G.DB.getFamilyById === "function"],
  ["DB.getMembers", () => typeof G.DB.getMembers === "function"],
  [
    "DB.getTransactions",
    () => typeof G.DB.getTransactions === "function",
  ],
  ["DB.addTx", () => typeof G.DB.addTx === "function"],
  ["DB.updateTx", () => typeof G.DB.updateTx === "function"],
  ["DB.deleteTx", () => typeof G.DB.deleteTx === "function"],
  ["DB.getSms", () => typeof G.DB.getSms === "function"],
  ["DB.addSms", () => typeof G.DB.addSms === "function"],
  ["DB.updateSms", () => typeof G.DB.updateSms === "function"],
  [
    "DB.getFamilySettings",
    () => typeof G.DB.getFamilySettings === "function",
  ],
  [
    "DB.saveFamilySettings",
    () => typeof G.DB.saveFamilySettings === "function",
  ],
  ["DB.validateSession", () => typeof G.DB.validateSession === "function"],
  ["DB.logout", () => typeof G.DB.logout === "function"],
  ["DB.addSmsBatch", () => typeof G.DB.addSmsBatch === "function"],
  ["qrcode fn", () => typeof G.qrcode === "function"],
  ["SmsParser.parse", () => typeof G.SmsParser.parse === "function"],
  ["Jalali.today", () => typeof G.Jalali.today === "function"],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    const ok = fn();
    console.log(ok ? "  ✓" : "  ✗", name);
    if (!ok) failed++;
  } catch (e) {
    console.log("  ✗", name, "→", e.message);
    failed++;
  }
}

/* ── تست نرمال‌سازی شماره ── */
const phones = [
  ["09123456789", "09123456789"],
  ["۹۱۲۳۴۵۶۷۸۹", ""] /* بدون صفر — نامعتبر */,
  ["+989123456789", "09123456789"],
  ["00989123456789", "09123456789"],
  ["989123456789", "09123456789"],
  ["0912", ""],
];
for (const [inp, want] of phones) {
  const got = G.DB.normalizePhone(inp);
  const ok = got === want;
  console.log(ok ? "  ✓" : "  ✗", `phone(${inp}) = ${got || "''"}`);
  if (!ok) failed++;
}

/* ── تست پارس پیامک ── */
const sms = G.SmsParser.parse(
  "بانک ملت؛ برداشت مبلغ ۲۵۰,۰۰۰ ریال؛ مانده حساب ۱۲,۵۰۰,۰۰۰؛ ۱۴۰۴/۰۶/۱۵-۱۴:۳۰",
);
console.log("  SMS:", JSON.stringify(sms));
if (sms.type !== "expense" || sms.amount !== 250000) {
  console.error("SMS parse failed");
  failed++;
}

/* ── تست QR ── */
const qr = G.qrcode(0, "M");
qr.addData("https://example.com/?invite=abc");
qr.make();
console.log("  QR modules:", qr.getModuleCount());
if (qr.getModuleCount() < 21) failed++;

console.log(failed === 0 ? "\nALL_CHECKS_PASSED" : `\n${failed} CHECKS FAILED`);
process.exit(failed === 0 ? 0 : 1);
