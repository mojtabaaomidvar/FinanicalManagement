import type { WalletBalanceState } from "./useWalletBalances";
import { addMoney, type Money } from "@/shared/lib/money";

export type WalletBalanceSummary = { status: "loading" | "error"; balance: null; reconciled: false }
  | { status: "ready"; balance: Money; reconciled: boolean };

/** Never fill missing authoritative balances with a partial sum or ledger fallback. */
export function summarizeWalletBalances(ids: readonly string[], rows: ReadonlyMap<string, WalletBalanceState>): WalletBalanceSummary {
  const states = [...new Set(ids)].map(id => rows.get(id));
  if (states.some(state => state?.status === "error")) return { status: "error", balance: null, reconciled: false };
  if (states.some(state => state?.status !== "ready")) return { status: "loading", balance: null, reconciled: false };
  const balances = states.flatMap(state => state?.status === "ready" ? [state.value] : []);
  return { status: "ready", balance: addMoney(...balances.map(value => value.currentBalance)),
    reconciled: balances.some(value => value.activeReconciliationId !== null) };
}
