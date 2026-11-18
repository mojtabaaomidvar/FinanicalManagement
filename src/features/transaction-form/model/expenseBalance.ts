import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { accountBalances } from "@/domain/report/report.rules";

export interface ExpenseBalanceWarning {
  account: Account;
  available: number;
  amount: number;
  remaining: number;
}

/** Use base currency and replace the stored transaction's effect when editing. */
export function expenseBalanceWarning(
  account: Account,
  transactions: Transaction[],
  amount: number,
  editingId?: string,
): ExpenseBalanceWarning | null {
  const [{ balance: available }] = accountBalances(
    transactions.filter(transaction => transaction.id !== editingId),
    [account],
  );
  const remaining = available - amount;
  return remaining < 0 ? { account, available, amount, remaining } : null;
}

/** Consent only covers the account, expense and balance the user actually reviewed. */
export function sameExpenseBalance(
  reviewed: ExpenseBalanceWarning | null,
  current: ExpenseBalanceWarning,
): boolean {
  return reviewed?.account.id === current.account.id
    && reviewed.available === current.available
    && reviewed.amount === current.amount;
}
