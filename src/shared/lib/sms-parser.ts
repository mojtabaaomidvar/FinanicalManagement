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
}

const BANKS: { re: RegExp; name: string }[] = [
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
  { re: /development/i, name: "بانک توسعه صادرات" },
  { re: /سامان|saman/i, name: "بانک سامان" },
  { re: /انصاری|ansari/i, name: "بانک انصاری" },
  { re: /گردشگری|tourism/i, name: "بانک گردشگری" },
  { re: /حکمت|hekmat/i, name: "بانک حکمت" },
  { re: /دی|day/i, name: "بانک دی" },
  { re: /ایران.?زمین|iranzamin/i, name: "بانک ایران‌زمین" },
  { re: /قرض.?الحسنه|qarz|mehr/i, name: "بانک قرض‌الحسنه" },
  { re: /شهر|shahr/i, name: "بانک شهر" },
  { re: /آینده|ayandeh/i, name: "بانک آینده" },
  { re: /سرمایه|sarmayeh/i, name: "بانک سرمایه" },
  { re: /کارآفرین|karafarin/i, name: "بانک کارآفرین" },
  { re: /سینا|sina/i, name: "بانک سینا" },
  { re: /مهر|mehr/i, name: "بانک مهر ایران" },
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
  for (const b of BANKS) {
    if (b.re.test(text)) return b.name;
  }
  return null;
}

export function extractDate(text: string): SmsDate | null {
  const t = toEn(text);

  /* جلالی: ۱۴۰۴/۰۶/۱۵ */
  let m = t.match(/1[34]\d{2}[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const jy = +m[0].slice(0, 4);
    const jm = +m[1],
      jd = +m[2];
    if (jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31) {
      const [gy, gm, gd] = toGregorian(jy, jm, jd);
      return { gy, gm, gd, jalali: [jy, jm, jd] };
    }
  }

  /* میلادی: 2025-09-06 */
  m = t.match(/(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const gy = +m[1],
      gm = +m[2],
      gd = +m[3];
    return { gy, gm, gd, jalali: toJalali(gy, gm, gd) };
  }

  /* میلادی با روز اول: 06/09/2025 */
  m = t.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})/);
  if (m) {
    const gy = +m[3],
      gm = +m[2],
      gd = +m[1];
    return { gy, gm, gd, jalali: toJalali(gy, gm, gd) };
  }

  return null;
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

  /* حذف مبلغ موجودی از لیست مبالغ */
  const txAmounts = amounts.filter((a) => a.value !== balance);
  const amount = txAmounts.length ? txAmounts[0].value : (amounts[0]?.value ?? null);

  return {
    rawText: text,
    type,
    bank,
    amount,
    balance,
    date,
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
