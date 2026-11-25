/* قالب‌بندی مبالغ و اعداد برای نمایش فارسی */

import { toFa, toEn } from "./digits";
import { absMoney, formatMoney, type Money } from "./money";

/* ۱۲۳۴۵۶۷ → "۱,۲۳۴,۵۶۷" (بدون علامت — مثبت/منفی را رنگ نشان می‌دهد) */
export function formatAmount(n: number | Money): string {
  if (typeof n === "string") return formatMoney(absMoney(n), "تومان");
  return toFa(Math.round(Math.abs(n)).toLocaleString("en-US"));
}

/** Account balances must show their sign, including fractional negative amounts. */
export function formatSignedAmount(n: number | Money): string {
  if (typeof n === "string") return formatMoney(n, "تومان");
  return toFa(n.toLocaleString("en-US", { maximumFractionDigits: 2 }));
}

/** Preserve rial precision; the chosen toman display rounds only the presentation. */
export function formatAccountAmount(amountInToman: number | Money, currency: string): string {
  if (typeof amountInToman === "string") return formatMoney(amountInToman, currency);
  const displayed = currency === "ریال" ? amountInToman * 10 : Math.round(amountInToman);
  return toFa(displayed.toLocaleString("en-US", { maximumFractionDigits: currency === "ریال" ? 2 : 0 }));
}

/* درصد فارسی */
export function formatPercent(n: number): string {
  return toFa(Math.round(n)) + "٪";
}

/* ساعت فعلی به شکل "HH:MM" */
export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* "14:30" → "۱۴:۳۰" */
export function formatTime(t: string): string {
  return toFa(t);
}

/* ورودی مبلغ کاربر (فارسی/با جداکننده) → عدد؛ خالی/نامعتبر → 0 */
export function parseAmountInput(raw: string): number {
  const digits = toEn(String(raw)).replace(/[^\d]/g, "");
  return digits ? +digits : 0;
}

/* فرمت زنده ورودی مبلغ: "1200000" → "۱,۲۰۰,۰۰۰" */
export function liveFormatAmount(raw: string): string {
  const digits = toEn(String(raw)).replace(/[^\d]/g, "");
  return digits ? formatAmount(+digits) : "";
}

/* فرمت زنده ورودی تاریخ جلالی: "14040615" → "۱۴۰۴/۰۶/۱۵" */
export function liveFormatJalaliDate(raw: string): string {
  let v = toEn(String(raw)).replace(/[^\d]/g, "");
  if (v.length > 8) v = v.slice(0, 8);
  let out = v;
  if (v.length > 4) out = v.slice(0, 4) + "/" + v.slice(4);
  if (v.length > 6) out = v.slice(0, 4) + "/" + v.slice(4, 6) + "/" + v.slice(6);
  return toFa(out);
}
