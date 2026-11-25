import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { Account } from "@/domain/account/account.types";
import type { WalletBalance } from "@/domain/account/wallet.types";
import { usePageActivity } from "@/shared/lib/pageActivity";
import type { Money } from "@/shared/lib/money";
import { summarizeWalletBalances } from "./walletBalanceSummary";

export type WalletBalanceState = { status: "loading" } | { status: "error" } | { status: "ready"; value: WalletBalance };

/** Authoritative amounts include protected sources; missing data is never zero. */
export function useWalletBalances(accounts: Account[], enabled = true) {
  const { useCases, family, member, txs } = useApp();
  const active = usePageActivity();
  const scopeKey = JSON.stringify([family?.id, member?.id, member?.role, accounts.map(account => account.id)]);
  const accountIds = useMemo(() => accounts.map(account => account.id), [scopeKey]);
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; rows: Map<string, WalletBalanceState> } | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    if (!active || !enabled || !useCases || !family || !member) return;
    const rows = new Map<string, WalletBalanceState>(accountIds.map(id => [id, { status: "loading" }]));
    setSnapshot({ scopeKey, rows });
    for (const accountId of accountIds) {
      void useCases.walletCorrections.balance({ familyId: family.id, memberId: member.id, accountId }).then(
        value => { if (generation.current === ticket) { rows.set(accountId, { status: "ready", value }); setSnapshot({ scopeKey, rows: new Map(rows) }); } },
        () => { if (generation.current === ticket) { rows.set(accountId, { status: "error" }); setSnapshot({ scopeKey, rows: new Map(rows) }); } },
      );
    }
    return () => { generation.current += 1; };
  }, [scopeKey, accountIds, useCases, active, enabled, txs, reload]);
  const rows = snapshot?.scopeKey === scopeKey ? snapshot.rows : new Map<string, WalletBalanceState>();
  const currentBalances = new Map<string, Money>();
  for (const [id, state] of rows) if (state.status === "ready") currentBalances.set(id, state.value.currentBalance);
  return {
    rows, currentBalances, summary: summarizeWalletBalances(accountIds, rows),
    refresh: () => setReload(value => value + 1),
  };
}
