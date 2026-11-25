/* قوانین پیامک بانکی — ساخت پیش‌نویس تراکنش از پیامک (خالص) */

import { categoriesFor } from "../category/category.catalog";
import type { SmsTxType } from "./sms.types";
import type { BankSms } from "./sms.types";
import type { TransactionInput } from "../transaction/transaction.types";
import { normalizeSms, parseSms } from "@/shared/lib/sms-parser";
import { formatAmount } from "@/shared/lib/format";
import { jalaliToIso } from "@/shared/lib/jalali";
import { divideMoney, legacyIntegerMoney, normalizeMoney, type Money } from "@/shared/lib/money";

export interface SmsDraftDefaults {
  type: SmsTxType;
  categoryId: string;
  amount: Money;
  memberId: string;
  /** ورودی تاریخ جلالی کاربر-friendly: "۱۴۰۴/۰۶/۱۵" */
  jalaliDate: [number, number, number] | null;
  time: string | null;
  note: string;
  amountNeedsReview: boolean;
}

/** SMS rows retain the original numeric unit; only transaction drafts use toman. */
export function smsAmountInToman(rawText: string, amount: number | null): Money | null {
  // Numeric SMS contracts cannot reconstruct unsafe/fractional source numbers.
  // Such drafts require explicit review instead of silently losing precision.
  if (amount == null || !Number.isSafeInteger(amount) || amount <= 0) return null;
  const exact = legacyIntegerMoney(amount);
  const text = normalizeSms(rawText).replace(/[٬،]/g, ",");
  const matchingUnits = [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(ریال|تومان)/g)]
    .filter(match => { try { return normalizeMoney(match[1].replace(/,/g, "")) === exact; } catch { return false; } })
    .map(match => match[2]);
  const units = new Set(matchingUnits.length ? matchingUnits : text.match(/ریال|تومان/g) ?? []);
  if (units.size !== 1) return null;
  return units.has("ریال") ? divideMoney(exact, "10") : exact;
}

/**
 * حدس مقادیر پیش‌فرض فرم ثبت پیامک:
 * نوع/دسته از خود پیامک، عضو = عضو فعلی؛ تاریخ و ساعت فقط از متن معتبر
 */
export function smsDraftDefaults(
  sms: BankSms,
  currentMemberId: string,
): SmsDraftDefaults {
  const parsed = parseSms(sms.rawText || "");
  const type: SmsTxType = sms.type ?? parsed?.type ?? "expense";

  let categoryId = parsed?.category ?? null;
  if (!categoryId || !categoriesFor(type).some((c) => c.id === categoryId)) {
    categoryId = categoriesFor(type)[0].id;
  }

  // Reparse legacy rows too: their stored dates may have rolled over invalid dates.
  const jalaliDate = parsed?.date?.jalali ?? null;
  const note = "";
  const amount = smsAmountInToman(sms.rawText, sms.amount ?? parsed?.amount ?? null);

  return {
    type,
    categoryId,
    amount: amount ?? "0",
    memberId: sms.memberId ?? currentMemberId,
    jalaliDate,
    time: parsed?.time ?? null,
    note,
    amountNeedsReview: amount == null,
  };
}

/** شرح خوانا برای تراکنش پیامکی — بانک + نوع + مبلغ (بدون متن خام پیامک) */
export function smsSummary(sms: BankSms): string {
  const parsed = parseSms(sms.rawText || "");
  const type = sms.type ?? parsed?.type;
  const amount = sms.amount ?? parsed?.amount;
  const bank = sms.bank ?? parsed?.bank;
  const parts: string[] = [];
  if (bank) parts.push(bank);
  if (type) parts.push(type === "income" ? "واریز" : "برداشت");
  if (amount) parts.push(formatAmount(amount));
  return parts.length ? parts.join(" — ") : "تراکنش پیامکی";
}

/** تبدیل پیش‌نویس به ورودی تراکنش */
export function draftToTransactionInput(d: {
  type: SmsTxType;
  categoryId: string;
  amount: string;
  memberId: string;
  jalaliDate: [number, number, number];
  note: string;
}): TransactionInput {
  return {
    type: d.type,
    category: d.categoryId,
    amount: d.amount,
    memberId: d.memberId,
    date: jalaliToIso(d.jalaliDate),
    note: d.note,
  };
}
