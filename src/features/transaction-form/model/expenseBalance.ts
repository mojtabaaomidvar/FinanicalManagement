import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { accountBalances } from "@/domain/report/report.rules";
import { addMoney, compareMoney, subtractMoney, type Money } from "@/shared/lib/money";

export interface ExpenseBalanceWarning {
  account: Account;
  available: Money;
  amount: Money;
  remaining: Money;
}

/** Remove only known edited effects from the authoritative balance. */
export function availableAccountBalance(account: Account, transactions: Transaction[], editingId?: string, currentBalance?: Money): Money {
  const filtered = transactions.filter(transaction => !editingId || (transaction.id !== editingId && transaction.transferFeeForId !== editingId));
  const [{ balance: without }] = accountBalances(filtered, [account]);
  if (currentBalance === undefined) return without;
  const [{ balance: withOriginal }] = accountBalances(transactions, [account]);
  return addMoney(currentBalance, subtractMoney(without, withOriginal));
}

/** Use base currency and replace the stored transaction's effect when editing. */
export function expenseBalanceWarning(
  account: Account,
  transactions: Transaction[],
  amount: Money,
  editingId?: string,
  currentBalance?: Money,
): ExpenseBalanceWarning | null {
  const available = availableAccountBalance(account, transactions, editingId, currentBalance);
  const remaining = subtractMoney(available, amount);
  return compareMoney(remaining, "0") < 0 ? { account, available, amount, remaining } : null;
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
