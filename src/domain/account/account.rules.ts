/* قوانین کارت/حساب — اعتبارسنجی و ماسک (خالص، قابل تست) */

import type { AccountInput } from "./account.types";
import { toEn, toFa } from "@/shared/lib/digits";

export type AccountValidationCode =
  | "INVALID_TITLE"
  | "INVALID_MEMBER"
  | "INVALID_CARD"
  | "EMPTY_ACCOUNT"
  | "INVALID_INITIAL_BALANCE";

export interface AccountValidationResult {
  ok: boolean;
  error?: AccountValidationCode;
}

export const MAX_TITLE_LENGTH = 40;

/** فقط ارقام انگلیسی (ورودی فارسی هم تبدیل می‌شود) */
export function digitsOf(raw: string): string {
  return toEn(String(raw)).replace(/\D/g, "");
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

  /* کیف‌پول فقط نام دارد — شماره کارت لازم نیست */
  if (input.kind !== "wallet" && !card) {
    return { ok: false, error: "EMPTY_ACCOUNT" };
  }

  const initial = input.initialBalance ?? 0;
  if (!Number.isFinite(initial) || initial < 0) {
    return { ok: false, error: "INVALID_INITIAL_BALANCE" };
  }
  return { ok: true };
}

/** «•••• •••• •••• ۱۲۳۴» — فقط ۴ رقم آخر نمایان */
export function maskCardNumber(card: string): string {
  const digits = digitsOf(card);
  if (digits.length !== 16) return "•".repeat(digits.length);
  const last4 = toFa(digits.slice(12));
  return `•••• •••• •••• ${last4}`;
}

/** شماره کارت گروه‌بندی‌شده با ارقام فارسی: ۶۲۱۹ ۸۶۱۰ ... */
export function formatCardFa(card: string): string {
  const fa = toFa(digitsOf(card));
  /* گروه‌بندی با slice — ارقام فارسی در regex \d نمی‌آیند */
  const groups: string[] = [];
  for (let i = 0; i < fa.length; i += 4) {
    groups.push(fa.slice(i, i + 4));
  }
  return groups.join(" ");
}
