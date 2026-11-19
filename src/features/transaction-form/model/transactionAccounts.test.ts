import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { transactionAccountChoices } from "./transactionAccounts";
const account = (id: string, balance: number, kind: "bank" | "wallet" = "bank", memberId = "self"): Account => ({
  id, familyId: "family", memberId, title: id, kind, bank: null, cardNumber: null,
  initialBalance: balance, smsEnabled: false, createdAt: "2026-11-19",
});
describe("transaction account choices", () => {
  it("shows only owned accounts and respects amount even after show all", () => {
    const accounts = [account("enough", 200_000), account("short", 20_000), account("foreign", 300_000, "bank", "other")];
    expect(transactionAccountChoices(accounts, [], "self", 100_000, true, true).map(row => row.account.id)).toEqual(["enough"]);
  });
  it("reveals low cash wallets on demand, including zero balances for incoming payments", () => {
    const accounts = [account("low", 99_999, "wallet"), account("boundary", 100_000, "wallet"), account("zero", 0, "wallet")];
    expect(transactionAccountChoices(accounts, [], "self", 10_000, false, false).map(row => row.account.id)).toEqual(["boundary"]);
    expect(transactionAccountChoices(accounts, [], "self", 10_000, false, true)).toHaveLength(3);
    expect(transactionAccountChoices(accounts, [], "self", 100_000, true, true).map(row => row.account.id)).toEqual(["boundary"]);
  });
  it("uses ledger balances and reverses the edited transaction when checking spending capacity", () => {
    const accounts = [account("cash", 200_000)];
    const tx = { id: "paid", type: "expense", amount: 150_000, accountId: "cash" } as Transaction;
    expect(transactionAccountChoices(accounts, [tx], "self", 100_000, true, true)).toHaveLength(0);
    expect(transactionAccountChoices(accounts, [tx], "self", 200_000, true, true, "paid")[0].balance).toBe(200_000);
  });
  it("allows another family member's account as a transfer destination", () => {
    expect(transactionAccountChoices([account("other", 0, "bank", "peer")], [], null, null, false, false)).toHaveLength(1);
  });
});
