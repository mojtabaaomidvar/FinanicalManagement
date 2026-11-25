import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { expenseBalanceWarning, sameExpenseBalance } from "./expenseBalance";

const account = { id: "cash", initialBalance: "100", kind: "wallet", title: "Cash" } as Account;
const tx = (id: string, type: Transaction["type"], amount: number, accountId = account.id, toAccountId: string | null = null): Transaction =>
  ({ id, type, amount: String(amount), accountId, toAccountId } as Transaction);

describe("expense balance confirmation", () => {
  it("permits a cost below or exactly equal to the available balance", () => {
    expect(expenseBalanceWarning(account, [], "99")).toBeNull();
    expect(expenseBalanceWarning(account, [], "100")).toBeNull();
  });

  it("includes income, expenses and both directions of transfers for this account", () => {
    const rows = [tx("salary", "income", 200), tx("food", "expense", 80),
      tx("out", "transfer", 50, "cash", "other"), tx("in", "transfer", 10, "other", "cash"),
      tx("foreign", "expense", 900, "other"), tx("unassigned", "expense", 900, "")];
    expect(expenseBalanceWarning(account, rows, "181")).toMatchObject({ available: "180", amount: "181", remaining: "-1" });
  });

  it("warns for zero or already negative balances and keeps fractional base amounts", () => {
    expect(expenseBalanceWarning(account, [tx("spent", "expense", 100)], "0.5")).toMatchObject({ available: "0", remaining: "-0.5" });
    expect(expenseBalanceWarning(account, [tx("spent", "expense", 120)], "10")).toMatchObject({ available: "-20", remaining: "-30" });
  });

  it("replaces the old expense rather than subtracting it a second time when editing", () => {
    const rows = [tx("editing", "expense", 90)];
    expect(expenseBalanceWarning(account, rows, "95", "editing")).toBeNull();
    expect(expenseBalanceWarning(account, rows, "101", "editing")).toMatchObject({ available: "100", remaining: "-1" });
  });

  it("does not restore an expense from another account into the chosen account", () => {
    expect(expenseBalanceWarning(account, [tx("editing", "expense", 90, "other")], "110", "editing"))
      .toMatchObject({ available: "100", remaining: "-10" });
  });

  it("removes the original income or incoming transfer when changing it to an expense", () => {
    expect(expenseBalanceWarning(account, [tx("editing", "income", 200)], "150", "editing"))
      .toMatchObject({ available: "100", remaining: "-50" });
    expect(expenseBalanceWarning(account, [tx("editing", "transfer", 200, "other", "cash")], "150", "editing"))
      .toMatchObject({ available: "100", remaining: "-50" });
  });

  it("invalidates consent when the balance, expense or chosen account changes", () => {
    const warning = expenseBalanceWarning(account, [], "150")!;
    expect(sameExpenseBalance(null, warning)).toBe(false);
    expect(sameExpenseBalance(warning, { ...warning })).toBe(true);
    expect(sameExpenseBalance(warning, { ...warning, available: "99" })).toBe(false);
    expect(sameExpenseBalance(warning, { ...warning, amount: "151" })).toBe(false);
    expect(sameExpenseBalance(warning, { ...warning, account: { ...account, id: "card" } })).toBe(false);
  });
});
