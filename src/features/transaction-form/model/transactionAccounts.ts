import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { accountBalances } from "@/domain/report/report.rules";

export function transactionAccountChoices(accounts: Account[], transactions: Transaction[], ownerId: string | null,
  amount: number | null, spends: boolean, showAll: boolean, editingId?: string) {
  const relevant = editingId ? transactions.filter(tx => tx.id !== editingId && tx.transferFeeForId !== editingId) : transactions;
  return accountBalances(relevant, accounts).filter(({ account, balance }) => (ownerId === null || account.memberId === ownerId)
    && (!spends || amount === null || balance >= amount)
    && (showAll || account.kind !== "wallet" || balance >= 100_000));
}
