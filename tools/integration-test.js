/* تست یکپارچگی — اجرای همه اسکریپت‌ها در محیط شبیه‌سازی‌شده */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

/* Mock browser environment */
const elements = {};
function makeEl(id) {
  return {
    id,
    innerHTML: "",
    textContent: "",
    value: "",
    checked: false,
    style: {},
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) {
        this._set.add(c);
      },
      remove(c) {
        this._set.delete(c);
      },
      toggle(c, f) {
        if (f) this._set.add(c);
        else this._set.delete(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    focus() {},
    files: [],
  };
}

global.document = {
  querySelector(sel) {
    if (!elements[sel]) elements[sel] = makeEl(sel);
    return elements[sel];
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  documentElement: { dataset: {} },
  createElement() {
    return makeEl("tmp");
  },
  body: { style: {} },
};
global.window = { scrollTo() {}, addEventListener() {} };
global.navigator = {};
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
global.location = { reload() {} };
global.confirm = () => true;
global.fetch = async () => ({
  ok: true,
  text: async () => "[]",
  json: async () => ({}),
});

/* Load all scripts in one shared scope */
const FILES = [
  "js/config.js",
  "js/jalali.js",
  "js/sms-parser.js",
  "js/db.js",
  "js/charts.js",
  "js/app.js",
];

const combined = FILES.map((f) =>
  fs.readFileSync(path.join(ROOT, f), "utf8"),
).join("\n;\n");

const run = new Function(
  "window",
  "document",
  "navigator",
  "localStorage",
  "location",
  "fetch",
  "confirm",
  "globalThis",
  combined + "\n;return { DB, SmsParser, Jalali, Charts, SUPABASE_CONFIG };",
);

try {
  const api = run(
    global.window,
    global.document,
    global.navigator,
    global.localStorage,
    global.location,
    global.fetch,
    global.confirm,
    global,
  );
  console.log("ALL_SCRIPTS_LOADED_OK");
  console.log("DB API:", Object.keys(api.DB).join(", "));
  console.log("SmsParser API:", Object.keys(api.SmsParser).join(", "));

  /* تست پارس پیامک */
  const p = api.SmsParser.parse(
    "بانک ملت;برداشت مبلغ 250,000 ریال;مانده حساب:12,500,000 ریال;1404/06/15-14:30",
  );
  console.log(
    "SMS parse:",
    JSON.stringify({
      type: p.type,
      bank: p.bank,
      amount: p.amount,
      balance: p.balance,
      date: p.date ? p.date.jalali : null,
      category: p.category,
    }),
  );
} catch (e) {
  console.error("LOAD_ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
}
