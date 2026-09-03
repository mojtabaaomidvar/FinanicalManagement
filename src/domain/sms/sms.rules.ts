/* قوانین پیامک بانکی — ساخت پیش‌نویس تراکنش از پیامک (خالص) */

import { categoriesFor } from "../category/category.catalog";
import type { SmsTxType } from "./sms.types";
import type { BankSms } from "./sms.types";
import type { TransactionInput } from "../transaction/transaction.types";
import { parseSms } from "@/shared/lib/sms-parser";
import { formatAmount } from "@/shared/lib/format";
import { isoToJalali, jalaliToIso, today } from "@/shared/lib/jalali";

export interface SmsDraftDefaults {
  type: SmsTxType;
  categoryId: string;
  amount: number;
  memberId: string;
  /** ورودی تاریخ جلالی کاربر-friendly: "۱۴۰۴/۰۶/۱۵" */
  jalaliDate: [number, number, number];
  note: string;
}

/**
 * حدس مقادیر پیش‌فرض فرم ثبت پیامک:
 * نوع/دسته از خود پیامک، عضو = عضو فعلی، تاریخ = تاریخ پیامک یا امروز
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

  const jalaliDate = sms.date
    ? isoToJalali(sms.date)
    : parsed?.date
      ? parsed.date.jalali
      : today();

  const note = smsSummary(sms);

  return {
    type,
    categoryId,
    amount: sms.amount ?? parsed?.amount ?? 0,
    memberId: sms.memberId ?? currentMemberId,
    jalaliDate,
    note,
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
  amount: number;
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
