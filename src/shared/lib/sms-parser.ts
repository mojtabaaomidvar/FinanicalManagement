/* پارسر پیامک‌های بانکی ایرانی
   تشخیص: نوع (واریز/برداشت)، مبلغ، موجودی، بانک، تاریخ — منطق خالص */

import { toJalali, toGregorian } from "./jalali";
import { toEn } from "./digits";

export type SmsTxType = "income" | "expense";

export interface SmsDate {
  gy: number;
  gm: number;
  gd: number;
  jalali: [number, number, number];
}

export interface ParsedSms {
  rawText: string;
  type: SmsTxType | null;
  bank: string | null;
  amount: number | null;
  balance: number | null;
  date: SmsDate | null;
  category: string | null;
  time: string | null;
}

const BANKS: { re: RegExp; name: string }[] = [
  { re: /توسعه\s*صادرات|export\s*development/i, name: "بانک توسعه صادرات" },
  { re: /(?:قرض\s*الحسنه\s*)?مهر\s*ایران|mehr\s*iran/i, name: "بانک مهر ایران" },
  { re: /ملی|BMI|bank.?melli/i, name: "بانک ملی" },
  { re: /ملت|BMEL|tejarat.?area/i, name: "بانک ملت" },
  { re: /صادرات|BSIR|bsi/i, name: "بانک صادرات" },
  { re: /تجارت|tejarat/i, name: "بانک تجارت" },
  { re: /پاسارگاد|pasargad/i, name: "بانک پاسارگاد" },
  { re: /پارسیان|parsian/i, name: "بانک پارسیان" },
  { re: /سپه|sepah/i, name: "بانک سپه" },
  { re: /کشاورزی|keshavarzi|bki/i, name: "بانک کشاورزی" },
  { re: /رفاه|refah/i, name: "بانک رفاه" },
  { re: /مسکن|maskan/i, name: "بانک مسکن" },
  { re: /سامان|saman/i, name: "بانک سامان" },
  { re: /انصاری|ansari/i, name: "بانک انصاری" },
  { re: /گردشگری|tourism/i, name: "بانک گردشگری" },
  { re: /حکمت|hekmat/i, name: "بانک حکمت" },
  { re: /بانک\s*دی|day\s*bank|bank\s*day/i, name: "بانک دی" },
  { re: /ایران.?زمین|iranzamin/i, name: "بانک ایران‌زمین" },
  { re: /قرض.?الحسنه|qarz/i, name: "بانک قرض‌الحسنه" },
  { re: /شهر|shahr/i, name: "بانک شهر" },
  { re: /آینده|ayandeh/i, name: "بانک آینده" },
  { re: /سرمایه|sarmayeh/i, name: "بانک سرمایه" },
  { re: /کارآفرین|karafarin/i, name: "بانک کارآفرین" },
  { re: /سینا|sina/i, name: "بانک سینا" },
  { re: /خاورمیانه|khavarmianeh/i, name: "بانک خاورمیانه" },
];

const INCOME_WORDS = [
  "واریز",
  "واریز شد",
  "واریز به",
  "رسید",
  "رسیدید",
  "دریافت",
  "کارمزد واریز",
  "انتقال به حساب شما",
  "به حساب شما واریز",
  "deposit",
  "credited",
];

const EXPENSE_WORDS = [
  "برداشت",
  "برداشت شد",
  "پرداخت",
  "خرید",
  "انتقال",
  "پرداخت اینترنتی",
  "خرید اینترنتی",
  "کارت به کارت",
  "برداشت از",
  "پرداخت قبض",
  "شارژ",
  "withdraw",
  "purchase",
  "payment",
];

/* نرمال‌سازی: ارقام فارسی/عربی + حروف عربی → فارسی + حذف نویسه‌های نامرئی */
export function normalizeSms(s: string): string {
  return toEn(String(s))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200f\u200e]/g, "");
}

/* همه اعداد بزرگ متن (>= 1000) */
export function extractAmounts(text: string): { raw: string; value: number }[] {
  const t = toEn(text);
  const matches = [...t.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?/g)];
  return matches
    .map((m) => ({ raw: m[1], value: +m[1].replace(/,/g, "") }))
    .filter((m) => m.value >= 1000);
}

export function detectType(text: string): SmsTxType | null {
  const t = text.toLowerCase();
  let income = 0,
    expense = 0;
  for (const w of INCOME_WORDS) if (t.includes(w)) income++;
  for (const w of EXPENSE_WORDS) if (t.includes(w)) expense++;
  if (income > expense) return "income";
  if (expense > income) return "expense";
  return null;
}

export function detectBank(text: string): string | null {
  let remaining = normalizeSms(text);
  const hits = new Set<string>();
  for (const b of BANKS) {
    const bounded = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${b.re.source})(?![\\p{L}\\p{N}_])`, "giu");
    if (bounded.test(remaining)) {
      hits.add(b.name);
      remaining = remaining.replace(bounded, " ");
    }
  }
  return hits.size === 1 ? [...hits][0] : null;
}

export function extractDate(text: string): SmsDate | null {
  const t = toEn(text);
  const candidates: SmsDate[] = [];
  for (const m of t.matchAll(/(?<!\d)(\d{4}|\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{1,2})(?!\d)/g)) {
    const [a, b, c] = m.slice(1).map(Number);
    try {
      let candidate: SmsDate;
      if (a >= 1300 && a <= 1499) {
        const [gy, gm, gd] = toGregorian(a, b, c);
        if (toJalali(gy, gm, gd).join() !== [a, b, c].join()) return null;
        candidate = { gy, gm, gd, jalali: [a, b, c] };
      } else {
        const [gy, gm, gd] = a >= 2000 && a <= 2099 ? [a, b, c]
          : c >= 2000 && c <= 2099 && a > 12 ? [c, b, a] : [];
        if (!gy || gm === undefined || gd === undefined) return null;
        const valid = new Date(Date.UTC(gy, gm - 1, gd));
        if (valid.getUTCFullYear() !== gy || valid.getUTCMonth() + 1 !== gm || valid.getUTCDate() !== gd) return null;
        candidate = { gy, gm, gd, jalali: toJalali(gy, gm, gd) };
      }
      candidates.push(candidate);
    } catch { return null; }
  }
  return candidates.length && new Set(candidates.map(c => `${c.gy}-${c.gm}-${c.gd}`)).size === 1 ? candidates[0] : null;
}

export function extractTime(text: string): string | null {
  const candidates: string[] = [];
  for (const m of toEn(text).matchAll(/(?<![\d:])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g)) {
    if (+m[1] > 23 || +m[2] > 59 || m[3] !== undefined && +m[3] > 59) return null;
    candidates.push(`${m[1].padStart(2, "0")}:${m[2]}${m[3] !== undefined ? `:${m[3]}` : ""}`);
  }
  return candidates.length && new Set(candidates).size === 1 ? candidates[0] : null;
}

export function extractBalance(text: string): number | null {
  const t = toEn(text);
  let m = t.match(/موجودی[^0-9]{0,15}(\d{1,3}(?:,\d{3})+|\d{4,})/);
  if (m) return +m[1].replace(/,/g, "");
  m = t.match(/مانده[^0-9]{0,15}(\d{1,3}(?:,\d{3})+|\d{4,})/);
  if (m) return +m[1].replace(/,/g, "");
  return null;
}

/* ── حدس دسته‌بندی از متن پیامک ── */
export function guessCategory(text: string): string | null {
  const t = text.toLowerCase();
  if (/قبض|برق|آب|گاز|تلفن|شارژ ماهانه/.test(t)) return "bills";
  if (/خرید|پرداخت اینترنتی|درگاه/.test(t)) return "shopping";
  if (/کارت به کارت|انتقال/.test(t)) return "other-e";
  if (/آموزش|شهریه/.test(t)) return "edu";
  if (/دارو|دکتر|بیمارستان|پزشک/.test(t)) return "health";
  if (/حقوق|salary/.test(t)) return "salary";
  return null;
}

/* ═══════════ پارس کامل ═══════════ */
export function parseSms(rawText: string): ParsedSms | null {
  const text = normalizeSms(rawText || "");
  if (!text) return null;

  const type = detectType(text);
  const bank = detectBank(text);
  const date = extractDate(text);
  const balance = extractBalance(text);
  const amounts = extractAmounts(text);

  /* مبلغ تراکنش:
     ۱) عددی که بعد از کلیدواژه «مبلغ» آمده (معتبرترین نشانگر)
     ۲) اولین عدد بزرگ ≠ موجودی
     ۳) اولین عدد بزرگ */
  let amount: number | null = null;
  const amountKw = text.match(
    /مبلغ[^0-9]{0,10}(\d{1,3}(?:,\d{3})+|\d{4,})/,
  );
  if (amountKw && +amountKw[1].replace(/,/g, "") !== balance) {
    amount = +amountKw[1].replace(/,/g, "");
  }
  if (amount == null) {
    const txAmounts = amounts.filter((a) => a.value !== balance);
    amount = txAmounts.length ? txAmounts[0].value : (amounts[0]?.value ?? null);
  }

  return {
    rawText: text,
    type,
    bank,
    amount,
    balance,
    date,
    time: extractTime(text),
    category: guessCategory(text),
  };
}

/* تفکیک چند پیامک با خط خالی */
export function splitSmsBlocks(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}
