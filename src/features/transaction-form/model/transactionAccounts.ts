import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { availableAccountBalance } from "./expenseBalance";
import { compareMoney, type Money } from "@/shared/lib/money";

export function transactionAccountChoices(accounts: Account[], transactions: Transaction[], ownerId: string | null,
  amount: Money | null, spends: boolean, showAll: boolean, editingId?: string, currentBalances?: ReadonlyMap<string, Money>) {
  return accounts.filter(account => !currentBalances || currentBalances.has(account.id)).map(account => ({ account,
    balance: availableAccountBalance(account, transactions, editingId, currentBalances?.get(account.id)),
  })).filter(({ account, balance }) => (ownerId === null || account.memberId === ownerId)
    && (!spends || amount === null || compareMoney(balance, amount) >= 0)
    && (showAll || account.kind !== "wallet" || compareMoney(balance, "100000") >= 0));
}
