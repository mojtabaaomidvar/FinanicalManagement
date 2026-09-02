/* قوانین دامنه تراکنش — اعتبارسنجی و مرتب‌سازی (خالص، قابل تست)
   اعتبارسنجی دسته: ثابت یا uuid دسته سفارشی — مالکیت نهایی در سرور چک می‌شود */

import { isValidCategory } from "../category/category.catalog";
import type { Transaction, TransactionInput } from "./transaction.types";
import { isoToJalali } from "@/shared/lib/jalali";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** دسته معتبر: از کاتالوگ ثابت یا uuid دسته سفارشی خانواده */
export function isValidCategoryId(id: string): boolean {
  return (
    isValidCategory(id, "expense") ||
    isValidCategory(id, "income") ||
    UUID_RE.test(id)
  );
}

export type TxValidationCode =
  | "INVALID_TYPE"
  | "INVALID_AMOUNT"
  | "INVALID_CATEGORY"
  | "INVALID_DATE"
  | "INVALID_MEMBER"
  | "INVALID_NOTE";

export interface TxValidationResult {
  ok: boolean;
  error?: TxValidationCode;
}

export const MAX_AMOUNT = 999_999_999_999;
export const MAX_NOTE_LENGTH = 200;

/** تاریخ باید میلادی ISO باشد — سال جلالی (مثل 1404) رد می‌شود */
function isValidGregorianIso(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const year = +date.slice(0, 4);
  if (year < 1900 || year > 2200) return false;
  return !isNaN(Date.parse(date));
}

export function validateTransaction(input: TransactionInput): TxValidationResult {
  if (input.type !== "expense" && input.type !== "income") {
    return { ok: false, error: "INVALID_TYPE" };
  }
  if (
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > MAX_AMOUNT
  ) {
    return { ok: false, error: "INVALID_AMOUNT" };
  }
  if (!input.category || !isValidCategoryId(input.category)) {
    return { ok: false, error: "INVALID_CATEGORY" };
  }
  if (!isValidGregorianIso(input.date)) {
    return { ok: false, error: "INVALID_DATE" };
  }
  if (!input.memberId) {
    return { ok: false, error: "INVALID_MEMBER" };
  }
  if ((input.note ?? "").length > MAX_NOTE_LENGTH) {
    return { ok: false, error: "INVALID_NOTE" };
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
