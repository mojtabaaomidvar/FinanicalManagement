import type { Transaction } from "@/domain/transaction/transaction.types";
import { visibleTransactions, transactionFeeAmount } from "@/domain/transaction/transaction.presentation";
import { isoToJalali, today, type JDate } from "@/shared/lib/jalali";
import { compareMoney } from "@/shared/lib/money";

export type TxFilter = "all" | "expense" | "income" | "transfer";
export type TxRange = "all" | "month" | "3m";
export interface TxAdvFilter {
  range: TxRange;
  accountId: string;
  categoryId: string;
  hasTransferFee?: boolean;
  /** Gregorian ISO boundaries, inclusive. These are filters, not a wallet scope. */
  fromDate?: string;
  toDate?: string;
}

export function validTransactionDateRange(from = "", to = ""): boolean {
  const validDate = (value: string) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  return validDate(from) && validDate(to) && (!from || !to || from <= to);
}

/** Apply the immutable scope before any removable display filters. */
export function filterTransactions(
  txs: Transaction[], filter: TxFilter, adv: TxAdvFilter, fixedAccountId = "", end: JDate = today(),
): Transaction[] {
  if (!validTransactionDateRange(adv.fromDate, adv.toDate)) return [];
  const accountId = fixedAccountId || adv.accountId;
  return visibleTransactions(txs).filter(tx => {
    if (accountId && tx.accountId !== accountId && tx.toAccountId !== accountId) return false;
    if (filter !== "all" && tx.type !== filter) return false;
    if (adv.categoryId && tx.category !== adv.categoryId) return false;
    if (adv.hasTransferFee && (compareMoney(transactionFeeAmount(tx), "0") <= 0 || (accountId && tx.accountId !== accountId))) return false;
    if (adv.fromDate && tx.date < adv.fromDate) return false;
    if (adv.toDate && tx.date > adv.toDate) return false;
    if (adv.range !== "all") {
      const [year, month] = isoToJalali(tx.date);
      const distance = (end[0] - year) * 12 + end[1] - month;
      if (distance < 0 || distance >= (adv.range === "month" ? 1 : 3)) return false;
    }
    return true;
  });
}
