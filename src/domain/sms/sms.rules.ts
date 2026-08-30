/* قوانین پیامک بانکی — ساخت پیش‌نویس تراکنش از پیامک (خالص) */

import { categoriesFor } from "../category/category.catalog";
import type { TxType } from "../transaction/transaction.types";
import type { BankSms } from "./sms.types";
import type { TransactionInput } from "../transaction/transaction.types";
import { parseSms } from "@/shared/lib/sms-parser";
import { isoToJalali, jalaliToIso, today } from "@/shared/lib/jalali";

export interface SmsDraftDefaults {
  type: TxType;
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
  const type: TxType = sms.type ?? parsed?.type ?? "expense";

  let categoryId = parsed?.category ?? null;
  if (!categoryId || !categoriesFor(type).some((c) => c.id === categoryId)) {
    categoryId = categoriesFor(type)[0].id;
  }

  const jalaliDate = sms.date
    ? isoToJalali(sms.date)
    : parsed?.date
      ? parsed.date.jalali
      : today();

  const note =
    (sms.bank ? sms.bank + " — " : "پیامک — ") +
    String(sms.rawText || "").slice(0, 50);

  return {
    type,
    categoryId,
    amount: sms.amount ?? parsed?.amount ?? 0,
    memberId: sms.memberId ?? currentMemberId,
    jalaliDate,
    note,
  };
}

/** تبدیل پیش‌نویس به ورودی تراکنش */
export function draftToTransactionInput(d: {
  type: TxType;
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
