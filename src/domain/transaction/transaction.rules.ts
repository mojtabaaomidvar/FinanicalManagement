/* قوانین دامنه تراکنش — اعتبارسنجی و مرتب‌سازی (خالص، قابل تست)
   اعتبارسنجی دسته: ثابت یا uuid دسته سفارشی — مالکیت نهایی در سرور چک می‌شود */

import { isValidCategory } from "../category/category.catalog";
import type { Transaction, TransactionInput, TxType } from "./transaction.types";
import { isoToJalali } from "@/shared/lib/jalali";
import { moneyFits } from "@/shared/lib/money";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** دسته معتبر: از کاتالوگ ثابت (هر نوع) یا uuid دسته سفارشی خانواده */
export function isValidCategoryId(id: string, type?: TxType): boolean {
  if (type) return isValidCategory(id, type) || (type !== "transfer" && UUID_RE.test(id));
  return (
    isValidCategory(id, "expense") ||
    isValidCategory(id, "income") ||
    isValidCategory(id, "transfer") ||
    UUID_RE.test(id)
  );
}

export type TxValidationCode =
  | "INVALID_TYPE"
  | "INVALID_AMOUNT"
  | "INVALID_CATEGORY"
  | "INVALID_DATE"
  | "INVALID_TIME"
  | "INVALID_MEMBER"
  | "INVALID_NOTE"
  | "INVALID_TRANSFER"
  | "INVALID_PAYMENT_METHOD"
  | "INVALID_TRANSFER_FEE"
  | "INVALID_REPEAT_END";

export interface TxValidationResult {
  ok: boolean;
  error?: TxValidationCode;
}

export const MAX_AMOUNT = "999999999999";
export const MAX_NOTE_LENGTH = 200;

/** تاریخ باید میلادی ISO باشد — سال جلالی (مثل 1404) رد می‌شود */
function isValidGregorianIso(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const year = +date.slice(0, 4);
  if (year < 1900 || year > 2200) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function validateTransaction(input: TransactionInput, existing?: Transaction): TxValidationResult {
  if (input.type !== "expense" && input.type !== "income" && input.type !== "transfer") {
    return { ok: false, error: "INVALID_TYPE" };
  }
  if (!moneyFits(input.amount, { scale: 2, min: "0.01", max: MAX_AMOUNT })) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }
  const unchangedHistory = existing && existing.type === input.type && existing.category === input.category
    && isValidCategoryId(input.category);
  if (!input.category || !isValidCategoryId(input.category, input.type) && !unchangedHistory) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }
  if (!isValidGregorianIso(input.date)) {
    return { ok: false, error: "INVALID_DATE" };
  }
  if (input.time != null && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(input.time)) {
    return { ok: false, error: "INVALID_TIME" };
  }
  if (!input.memberId) {
    return { ok: false, error: "INVALID_MEMBER" };
  }
  if ((input.note ?? "").length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "INVALID_NOTE" };
  }
  if (input.paymentMethod != null) {
    if (input.type !== "expense" || !["card", "online", "bank_transfer"].includes(input.paymentMethod)) {
      return { ok: false, error: "INVALID_PAYMENT_METHOD" };
    }
    if (input.paymentMethod !== "bank_transfer" && input.transferFeeMethod != null) {
      return { ok: false, error: "INVALID_TRANSFER_FEE" };
    }
  }
  /* انتقال: حساب مبدأ و مقصد الزامی و متفاوت */
  if (input.type === "transfer") {
    if (!input.accountId || !input.toAccountId) {
      return { ok: false, error: "INVALID_TRANSFER" };
    }
    if (input.accountId === input.toAccountId) {
      return { ok: false, error: "INVALID_TRANSFER" };
    }
  }
  /* تراکنش تکرارشونده حتماً تاریخ پایان معتبر بعد از تاریخ خود تراکنش دارد */
  if (input.repeat && input.repeat !== "none") {
    if (!input.repeatEnd || !isValidGregorianIso(input.repeatEnd)) {
      return { ok: false, error: "INVALID_REPEAT_END" };
    }
    if (input.repeatEnd < input.date) {
      return { ok: false, error: "INVALID_REPEAT_END" };
    }
  }
  return { ok: true };
}

/* مرتب‌سازی: تاریخ نزولی، سپس ساعت ثبت نزولی، سپس زمان ایجاد نزولی */
export function sortTxDesc(list: Transaction[]): Transaction[] {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const at = a.time ?? "";
    const bt = b.time ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
}

/* تراکنش‌های یک ماه جلالی */
export function txsInJalaliMonth(
  list: Transaction[],
  jy: number,
  jm: number,
): Transaction[] {
  return list.filter((t) => {
    const [y, m] = isoToJalali(t.date);
    return y === jy && m === jm;
  });
}

/* تراکنش‌های یک ماه جلالی تا روز مشخص (شامل خودش)
   برای مقایسه منصفانه ماه جاری با «همین بازه» از ماه گذشته */
export function txsInJalaliMonthUpToDay(
  list: Transaction[],
  jy: number,
  jm: number,
  day: number,
): Transaction[] {
  return list.filter((t) => {
    const [y, m, d] = isoToJalali(t.date);
    return y === jy && m === jm && d <= day;
  });
}
