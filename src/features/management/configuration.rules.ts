import { environmentLabels } from "./labels";

export const numericSettings: Record<string, { min: number; max: number; default: string }> = {
  AI_SMS_TIMEOUT_SECONDS: { min: 1, max: 25, default: "25" },
  AI_REQUESTS_PER_DAY: { min: 0, max: 1000000, default: "0" },
  AI_FAMILY_REQUESTS_PER_DAY: { min: 0, max: 100000, default: "0" },
  AI_MAX_CONCURRENT: { min: 0, max: 64, default: "0" },
  AI_MAX_OUTPUT_TOKENS: { min: 256, max: 8192, default: "1800" },
};
export type ImportedConfiguration = { values: Record<string, string>; empty: string[] };
export const configurationTemplate = (): string => JSON.stringify(
  Object.fromEntries(Object.keys(environmentLabels).map(key => [key, ""])), null, 2,
);

const invalidFile = () => new Error("ساختار فایل تنظیمات معتبر نیست؛ از نمونهٔ JSON یا env استفاده کنید.");
const duplicateKey = () => new Error("یک کلید تنظیمات در فایل تکرار شده است؛ هر کلید را فقط یک بار بنویسید.");

const jsonEntries = (source: string): [string, unknown][] => {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw invalidFile(); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidFile();
  const seen = new Set<string>();
  // Tokenize strings after JSON validation, so duplicate keys cannot silently overwrite each other.
  for (let at = 0; at < source.length; at++) {
    if (source[at] !== '"') continue;
    const start = at++;
    while (at < source.length && source[at] !== '"') { if (source[at] === "\\") at++; at++; }
    let next = at + 1;
    while (/\s/.test(source[next] ?? "") && next < source.length) next++;
    if (source[next] !== ":") continue;
    const key = JSON.parse(source.slice(start, at + 1)) as string;
    if (seen.has(key)) throw duplicateKey();
    seen.add(key);
  }
  return Object.entries(parsed);
};

const envEntries = (source: string): [string, unknown][] => {
  const entries: [string, unknown][] = [], seen = new Set<string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) throw invalidFile();
    const key = match[1];
    if (seen.has(key)) throw duplicateKey();
    seen.add(key);
    let value = match[2].trim();
    if (value.startsWith('"')) {
      const quoted = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(value);
      if (!quoted) throw invalidFile();
      try { value = JSON.parse(quoted[1]) as string; } catch { throw invalidFile(); }
    } else if (value.startsWith("'")) {
      const quoted = /^'([^']*)'\s*(?:#.*)?$/.exec(value);
      if (!quoted) throw invalidFile();
      value = quoted[1];
    } else value = value.replace(/\s+#.*$/, "").trim();
    entries.push([key, value]);
  }
  return entries;
};

export const parseConfiguration = (raw: string): ImportedConfiguration => {
  if (new TextEncoder().encode(raw).length > 65536) throw new Error("حجم فایل تنظیمات باید کمتر از ۶۴ کیلوبایت باشد.");
  const source = raw.replace(/^\uFEFF/, "").trim();
  const entries = source.startsWith("{") || source.startsWith("[") ? jsonEntries(source) : envEntries(source);
  if (!entries.length || entries.length > 64) throw invalidFile();
  const allowed = new Set(Object.keys(environmentLabels));
  const values: Record<string, string> = {}, empty: string[] = [];
  for (const [key, input] of entries) {
    if (!allowed.has(key)) throw new Error("فایل، تنظیمی خارج از فهرست مجاز پیامک و هوش مصنوعی دارد؛ چیزی وارد نشد.");
    if (typeof input !== "string" && !(key in numericSettings && typeof input === "number" && Number.isSafeInteger(input))) throw invalidFile();
    const value = String(input).trim();
    if (!value) { empty.push(key); continue; }
    if (value.length > 1024 || /[\r\n\u0000"'`$\\]/.test(value) || /^\[(?:redacted|configured)\]$/i.test(value)) {
      throw new Error("یکی از مقادیر تنظیمات معتبر نیست؛ مقدار کلیدها و نویسه‌های مجاز را بررسی کنید.");
    }
    if (key in numericSettings) {
      const bounds = numericSettings[key];
      if (!/^\d{1,7}$/.test(value) || Number(value) < bounds.min || Number(value) > bounds.max) {
        throw new Error("یکی از سقف‌ها یا زمان انتظار خارج از بازهٔ مجاز است؛ فایل را اصلاح کنید.");
      }
    }
    if (key === "SMS_PROVIDER" && value !== "kavenegar") throw new Error("درگاه پیامک فایل در این نسخه پشتیبانی نمی‌شود.");
    if (key === "AI_CONNECTION_MODE" && !["auto", "direct", "gateway", "disabled"].includes(value)) throw new Error("روش اتصال هوش مصنوعی فایل در این نسخه پشتیبانی نمی‌شود.");
    if (key === "AI_SMS_MODEL" && !/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new Error("نام مدل هوش مصنوعی فایل معتبر نیست.");
    if (key === "AI_SMS_GATEWAY_URL") {
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { throw new Error("نشانی درگاه فایل باید HTTPS و بدون نام کاربری، رمز یا پارامتر اضافه باشد."); }
    }
    values[key] = value;
  }
  if (!Object.keys(values).length) throw new Error("فایل مقدار غیرخالی برای ورود ندارد؛ تنظیمات واقعی خود را در نمونه بنویسید.");
  return { values, empty };
};
