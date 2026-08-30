/* قوانین کارت/حساب — اعتبارسنجی و ماسک (خالص، قابل تست) */

import type { AccountInput } from "./account.types";
import { toEn } from "@/shared/lib/digits";

export type AccountValidationCode =
  | "INVALID_TITLE"
  | "INVALID_MEMBER"
  | "INVALID_CARD"
  | "INVALID_SHEBA"
  | "INVALID_ACCOUNT_NO"
  | "EMPTY_ACCOUNT";

export interface AccountValidationResult {
  ok: boolean;
  error?: AccountValidationCode;
}

export const MAX_TITLE_LENGTH = 40;

/** فقط ارقام انگلیسی (ورودی فارسی هم تبدیل می‌شود) */
export function digitsOf(raw: string): string {
  return toEn(String(raw)).replace(/\D/g, "");
}

/** نرمال‌سازی شبا: IR + ۲۴ رقم */
export function normalizeSheba(raw: string): string {
  const s = toEn(String(raw)).toUpperCase().replace(/[^0-9IR]/g, "");
  const body = s.replace(/^IR/, "");
  return "IR" + body.replace(/\D/g, "").slice(0, 24);
}

export function validateAccountInput(
  input: AccountInput,
): AccountValidationResult {
  const title = input.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: "INVALID_TITLE" };
  }
  if (!input.memberId) {
    return { ok: false, error: "INVALID_MEMBER" };
  }

  const card = (input.cardNumber ?? "").trim();
  if (card && !/^\d{16}$/.test(digitsOf(card))) {
    return { ok: false, error: "INVALID_CARD" };
  }

  const sheba = (input.sheba ?? "").trim();
  if (sheba && !/^IR\d{24}$/.test(normalizeSheba(sheba))) {
    return { ok: false, error: "INVALID_SHEBA" };
  }

  const accNo = (input.accountNumber ?? "").trim();
  if (accNo && !/^\d{5,20}$/.test(digitsOf(accNo))) {
    return { ok: false, error: "INVALID_ACCOUNT_NO" };
  }

  if (!card && !sheba && !accNo) {
    return { ok: false, error: "EMPTY_ACCOUNT" };
  }
  return { ok: true };
}

/** «•••• •••• •••• ۱۲۳۴» — فقط ۴ رقم آخر نمایان */
export function maskCardNumber(card: string): string {
  const digits = digitsOf(card);
  if (digits.length !== 16) return "•".repeat(digits.length);
  return `•••• •••• •••• ${digits.slice(12)}`;
}

/** شماره کارت گروه‌بندی‌شده با ارقام فارسی: ۶۲۱۹ ۸۶۱۰ ... */
export function formatCardFa(card: string): string {
  const digits = digitsOf(card);
  const fa = digits.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
  return fa.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** شبا گروه‌بندی‌شده: IR12 3456 ... */
export function formatSheba(sheba: string): string {
  const s = normalizeSheba(sheba);
  return s.replace(/(.{4})(?=.)/g, "$1 ");
}
