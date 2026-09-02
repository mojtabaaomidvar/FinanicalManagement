/* قالب‌بندی مبالغ و اعداد برای نمایش فارسی */

import { toFa, toEn } from "./digits";

/* ۱۲۳۴۵۶۷ → "۱,۲۳۴,۵۶۷" */
export function formatAmount(n: number): string {
  return toFa(Math.round(Math.abs(n)).toLocaleString("en-US"));
}

/* مبلغ با علامت: درآمد +۱,۲۳۴ / هزینه ۱,۲۳۴ (قرمز از رنگ کلاس می‌آید) */
export function formatSigned(n: number, type: "income" | "expense"): string {
  return type === "income" ? "+" + formatAmount(n) : formatAmount(n);
}

/* درصد فارسی */
export function formatPercent(n: number): string {
  return toFa(Math.round(n)) + "٪";
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
