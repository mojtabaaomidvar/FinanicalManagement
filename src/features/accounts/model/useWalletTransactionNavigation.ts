import { useState } from "react";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { usePageActivity } from "@/shared/lib/pageActivity";
import type { Account } from "@/domain/account/account.types";
import { useApp } from "@/app/providers/AppProvider";

/** Retain each account's list/form, never across a viewer identity boundary. */
export function useWalletTransactionNavigation(accounts: Account[]) {
  const { family, member } = useApp();
  const active = usePageActivity();
  const identity = JSON.stringify([family?.id, member?.id, member?.role]);
  const [state, setState] = useState<{ identity: string; selected: string | null; visited: string[] }>({ identity, selected: null, visited: [] });
  const current = state.identity === identity ? state : { identity, selected: null, visited: [] };
  if (current !== state) setState(current);
  const back = () => setState(previous => ({ ...previous, selected: null }));
  useBackGuard(current.selected !== null, back);
  return {
    ...current, active, back,
    open: (account: Account) => {
      if (!active || !accounts.some(item => item.id === account.id && item.familyId === family?.id)) return;
      setState(previous => ({ identity, selected: account.id, visited: previous.visited.includes(account.id) ? previous.visited : [...previous.visited, account.id] }));
    },
  };
}
