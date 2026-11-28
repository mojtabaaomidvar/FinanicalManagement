import { useEffect, useRef } from "react";
import { usePageActivity } from "./pageActivity";

export interface QuickAddPageProps { quickAddId?: number; onQuickAddConsumed?: () => void }

/** A retained page consumes a UI request once, after its existing access/load gates. */
export function useQuickAddRequest(id: number | undefined, ready: boolean, open: () => void, consumed?: () => void) {
  const active = usePageActivity();
  const handled = useRef<number>();
  useEffect(() => {
    if (!id || !ready || !active || handled.current === id) return;
    handled.current = id; open(); consumed?.();
  }, [id, ready, active, open, consumed]);
}
