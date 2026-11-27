import { useEffect, useRef } from "react";

/** Preserve the current form and route while rereading a module's authorized data. */
export function useHouseholdRefresh(refresh: () => unknown) {
  const latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    const reload = () => { void Promise.resolve(latest.current()).catch(() => undefined); };
    window.addEventListener("household-data-changed", reload);
    return () => window.removeEventListener("household-data-changed", reload);
  }, []);
}
