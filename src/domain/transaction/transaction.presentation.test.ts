import { describe, expect, it } from "vitest";
import type { Transaction } from "./transaction.types";
import { transactionExpenseAmount, transactionFeeAmount, visibleTransactions } from "./transaction.presentation";
import type { Account } from "../account/account.types";
import { accountBalances, recentTransactions, totalBalance } from "../report/report.rules";

const parent: Transaction = {
  id: "parent", familyId: "family", memberId: "member", type: "expense", amount: 100000,
  category: "food", date: "2026-11-24", time: "14:37:52", note: "User note",
  accountId: "source", toAccountId: null, subcategoryId: null, repeat: "none", repeatEnd: null,
  photos: [], handledOccurrences: [], createdAt: "2026-11-24T11:07:52Z",
  transferFeeMethod: "paya", transferFeeRial: 4000, paymentMethod: "bank_transfer",
};
const fee: Transaction = { ...parent, id: "fee", amount: 400, category: "finance", note: null,
  sourceKind: "transfer_fee", transferFeeForId: parent.id, transferFeeMethod: null, transferFeeRial: null,
  createdAt: "2026-11-24T11:07:53Z", paymentMethod: null };

describe("presentation of linked payment fees", () => {
  it("shows only the parent, never mutating the raw ledger or removing information", () => {
    const raw = [fee, parent], snapshot = structuredClone(raw);
    expect(visibleTransactions(raw)).toEqual([parent]);
    expect(recentTransactions(raw, 1)).toEqual([parent]);
    expect(raw).toEqual(snapshot);
  });
  it("keeps orphaned historical fees and unrelated expenses visible", () => {
    expect(visibleTransactions([fee])).toEqual([fee]);
    expect(visibleTransactions([{ ...fee, transferFeeForId: null }, parent])).toHaveLength(2);
    expect(visibleTransactions([{ ...fee, sourceKind: null }, parent])).toHaveLength(2);
  });
  it("counts fee exactly once in displayed expense while balances use both ledger rows", () => {
    expect(transactionFeeAmount(parent)).toBe(400);
    expect(transactionExpenseAmount(parent)).toBe(100400);
    expect(totalBalance([parent, fee])).toBe(-100400);
    expect(accountBalances([parent, fee], [{ id: "source", initialBalance: 200000 } as Account])[0].balance).toBe(99600);
  });
  it("for account transfers, only the fee is an expense and only of the source account", () => {
    const transfer = { ...parent, type: "transfer" as const, toAccountId: "destination" };
    expect(transactionExpenseAmount(transfer)).toBe(400);
    expect(transactionExpenseAmount(transfer, "source")).toBe(400);
    expect(transactionExpenseAmount(transfer, "destination")).toBe(0);
    expect(totalBalance([transfer, fee])).toBe(-400);
  });
  it("card and online without a tariff contribute only the main expense", () => {
    for (const paymentMethod of ["card", "online"] as const) {
      const tx = { ...parent, paymentMethod, transferFeeMethod: null, transferFeeRial: null };
      expect(transactionFeeAmount(tx)).toBe(0);
      expect(transactionExpenseAmount(tx)).toBe(100000);
    }
  });
  it("zero-fee transfers do not invent an expense or a fee total", () => {
    const tx = { ...parent, type: "transfer" as const, toAccountId: "destination", transferFeeMethod: "internal" as const, transferFeeRial: 0 };
    expect(transactionFeeAmount(tx)).toBe(0);
    expect(transactionExpenseAmount(tx)).toBe(0);
    expect(visibleTransactions([tx])).toEqual([tx]);
  });
});
