import type { Bill, BillInput } from "./bill.types";
import { BILL_KINDS } from "./bill.types";
import { currencyFactor } from "@/shared/lib/currency";
import { toEn } from "@/shared/lib/digits";

// The existing bill and transaction database columns are Numeric(15, 2).
export const MAX_BILL_AMOUNT = 9_999_999_999_999.99;

export function parseBillAmount(raw: string, currency: string): number | null {
  const normalized = toEn(raw).replace(/[,٬،]/g, "").replace(/٫/g, ".").trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const base = Number(normalized) / currencyFactor(currency);
  const amount = Math.round(base * 100) / 100;
  return Number.isFinite(base) && base <= MAX_BILL_AMOUNT && amount > 0 ? amount : null;
}

/** Identifiers stay strings, including their leading zeroes. */
export function normalizeBillNumber(raw: string | null | undefined): string | null {
  const normalized = toEn(raw ?? "").replace(/\s/g, "");
  return normalized || null;
}

export function validateBillInput(input: BillInput): "kind" | "title" | "amount" | "date" | "number" | null {
  if (!BILL_KINDS.some(kind => kind.value === input.kind)) return "kind";
  if (!input.title.trim() || input.title.trim().length > 120) return "title";
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > MAX_BILL_AMOUNT) return "amount";
  const date = new Date(input.dueDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.dueDate) return "date";
  for (const raw of [input.billNo, input.paymentNo]) {
    const value = normalizeBillNumber(raw);
    if (value && (!/^\d+$/.test(value) || value.length > 40)) return "number";
  }
  return null;
}

/** Compare padded Gregorian dates; Jalali tuples coerce to unpadded strings. */
export function isBillOverdue(bill: Pick<Bill, "state" | "dueDate">, todayIso: string): boolean {
  return bill.state === "unpaid" && bill.dueDate < todayIso;
}
