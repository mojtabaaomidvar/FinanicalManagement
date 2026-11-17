import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { UseCases } from "@/application/useCases";
import { HomePreferenceSession, homePreferenceCacheKey } from "./homePreferenceSession";

export function useHomePreferences({ memberId, familyId, useCases, restricted }: {
  memberId?: string;
  familyId?: string;
  useCases: UseCases | null;
  restricted: boolean;
}) {
  const session = useMemo(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* The account API remains usable. */ }
    return new HomePreferenceSession({
      get: () => useCases!.getHomePreferences.execute(),
      set: (revision, preferences) => useCases!.setHomePreferences.execute(revision, preferences),
    }, homePreferenceCacheKey(familyId ?? "", memberId ?? ""), storage);
  }, [memberId, familyId, useCases]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    if (!memberId || !familyId || !useCases) return;
    session.activate(restricted);
    return () => { session.dispose(); };
  }, [session, memberId, familyId, useCases, restricted]);
  return { ...state, changePreferences: session.change, resetPreferences: session.reset, retry: session.retry };
}
