/* قوانین کارت/حساب — اعتبارسنجی و ماسک (خالص، قابل تست) */

import type { AccountInput, AccountPatch } from "./account.types";
import { toEn, toFa } from "@/shared/lib/digits";
import { moneyFits, parseMoneyInput, type Money } from "@/shared/lib/money";

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
export const MAX_ACCOUNT_BALANCE = "999999999999999";

/** Whole display units; unsupported input must not silently become another balance. */
export function parseAccountBalance(raw: string, currency: string): Money | null {
  if (!raw.trim()) return "0";
  const amount = parseMoneyInput(raw, currency);
  return amount !== null && moneyFits(amount, { scale: 1, min: "0", max: MAX_ACCOUNT_BALANCE }) ? amount : null;
}

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

  const initial = input.initialBalance ?? "0";
  if (!moneyFits(initial, { scale: 1, min: "0", max: MAX_ACCOUNT_BALANCE })) {
    return { ok: false, error: "INVALID_INITIAL_BALANCE" };
  }
  return { ok: true };
}

/**
 * اعتبارسنجی ویرایش — مثل افزودن، با دو تفاوت:
 * مالک و نوع حساب تغییر نمی‌کنند، و موجودی اولیه منفی مجاز است
 * (توضیح در AccountPatch.initialBalance).
 */
export function validateAccountPatch(
  patch: AccountPatch,
): AccountValidationResult {
  const title = patch.title.trim();
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: "INVALID_TITLE" };
  }

  const card = (patch.cardNumber ?? "").trim();
  if (card && !/^\d{16}$/.test(digitsOf(card))) {
    return { ok: false, error: "INVALID_CARD" };
  }
  if (patch.kind !== "wallet" && !card) {
    return { ok: false, error: "EMPTY_ACCOUNT" };
  }

  const initial = patch.initialBalance;
  if (initial != null && !moneyFits(initial, { scale: 1, min: "-999999999999999", max: MAX_ACCOUNT_BALANCE })) {
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
