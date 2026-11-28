import { useEffect, useState } from "react";
import type { UseCases } from "@/application/useCases";
import type { AccountTransferTarget } from "@/domain/account/account.types";

export function useTransferTargets(useCases: UseCases | null, scope: string, enabled: boolean) {
  const [attempt, retry] = useState(0);
  const [result, setResult] = useState<{
    scope: string; attempt: number; items: AccountTransferTarget[]; error: boolean;
  } | null>(null);
  const requestScope = `${scope}:${enabled}`;
  useEffect(() => {
    if (!enabled || !useCases) return;
    let current = true;
    setResult(null);
    void useCases.listAccounts.transferTargets().then(items => {
      if (current) setResult({ scope: requestScope, attempt, items, error: false });
    }).catch(() => {
      if (current) setResult({ scope: requestScope, attempt, items: [], error: true });
    });
    return () => { current = false; };
  }, [useCases, requestScope, enabled, attempt]);
  const current = enabled && result?.scope === requestScope && result.attempt === attempt ? result : null;
  return {
    items: current?.items ?? [],
    loading: enabled && !current,
    error: current?.error ?? false,
    retry: () => retry(value => value + 1),
  };
}
