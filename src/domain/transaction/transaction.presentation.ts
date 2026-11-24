import type { Transaction } from "./transaction.types";

/** Keep raw ledger rows for balances/reports. Collapse only linked fees in UI lists.
 * An orphaned historical fee is not hidden: otherwise its information would vanish.
 */
export function visibleTransactions(txs: Transaction[]): Transaction[] {
  const parents = new Set(txs.filter(tx => tx.sourceKind !== "transfer_fee").map(tx => tx.id));
  return txs.filter(tx => tx.sourceKind !== "transfer_fee" || !tx.transferFeeForId || !parents.has(tx.transferFeeForId));
}

/** Domain amounts are in toman; the server's fee snapshot is in rial. */
export function transactionFeeAmount(tx: Transaction): number {
  return tx.sourceKind === "transfer_fee" ? tx.amount : (tx.transferFeeRial ?? 0) / 10;
}

/** A destination-account view must not claim the source-account's fee expense. */
export function transactionExpenseAmount(tx: Transaction, accountId = ""): number {
  const fee = !accountId || tx.accountId === accountId ? transactionFeeAmount(tx) : 0;
  if (tx.sourceKind === "transfer_fee") return fee;
  return (tx.type === "expense" ? tx.amount : 0) + fee;
}
