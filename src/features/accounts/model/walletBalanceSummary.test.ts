import { describe, expect, it } from "vitest";
import type { WalletBalanceState } from "./useWalletBalances";
import { summarizeWalletBalances } from "./walletBalanceSummary";

const ready = (id: string, balance: string, reconciled = false): WalletBalanceState => ({ status: "ready", value: {
  accountId: id, revision: 1, ledgerBalance: "0", currentBalance: balance, discrepancy: balance,
  activeReconciliationId: reconciled ? "receipt" : null,
} });

describe("authoritative current-wallet summaries", () => {
  it("uses current rather than ledger money, preserving large and historical fractions", () => {
    const rows = new Map([["large", ready("large", "999999999999999.9")], ["fraction", ready("fraction", "0.01", true)]]);
    expect(summarizeWalletBalances(["large", "fraction"], rows)).toEqual({ status: "ready", balance: "999999999999999.91", reconciled: true });
  });
  it("never displays a partial total or zero for missing or failed data", () => {
    const rows = new Map([["known", ready("known", "100")]]);
    expect(summarizeWalletBalances(["known", "missing"], rows)).toEqual({ status: "loading", balance: null, reconciled: false });
    rows.set("missing", { status: "error" });
    expect(summarizeWalletBalances(["known", "missing"], rows)).toEqual({ status: "error", balance: null, reconciled: false });
  });
  it("scopes the exact sum to the requested ids and counts a wallet only once", () => {
    const rows = new Map([["mine", ready("mine", "-0.1")], ["other", ready("other", "900000")]]);
    expect(summarizeWalletBalances(["mine", "mine"], rows).balance).toBe("-0.1");
    expect(summarizeWalletBalances([], rows)).toEqual({ status: "ready", balance: "0", reconciled: false });
  });
});
