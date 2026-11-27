import { useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { INVENTORY_PRESETS, mergeInventoryCatalog } from "@/domain/inventory/inventory.catalog";

/** Public metadata only; a failed refresh never blocks the encrypted inventory outbox. */
export function useInventoryCatalog(open: boolean, online: boolean) {
  const { useCases } = useApp();
  const [entries, setEntries] = useState(INVENTORY_PRESETS);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || !useCases || !online) { setLoading(false); return; }
    let current = true, running = false;
    async function load() {
      if (running) return;
      running = true; setLoading(true); setFailed(false);
      try {
        const result = await useCases!.listInventoryCatalog.execute();
        if (current) setEntries(mergeInventoryCatalog(result));
      } catch {
        if (current) setFailed(true);
      } finally {
        running = false;
        if (current) setLoading(false);
      }
    }
    void load();
    window.addEventListener("focus", load);
    window.addEventListener("household-data-changed", load);
    return () => { current = false; window.removeEventListener("focus", load); window.removeEventListener("household-data-changed", load); };
  }, [open, useCases, online, attempt]);

  return { entries, loading, failed, retry: () => setAttempt(value => value + 1) };
}
