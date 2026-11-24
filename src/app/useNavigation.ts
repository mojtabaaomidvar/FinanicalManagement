import { useCallback, useEffect, useRef, useState } from "react";
import { createNavigation, routeFromUrl } from "./navigation";
import type { Route } from "./router";
import { afterGuards } from "@/shared/lib/backGuard";

export function useNavigation(identity: string) {
  const [visit, setVisit] = useState(() => ({ scope: identity, route: routeFromUrl(new URL(location.href)), depth: 0 }));
  const controller = useRef<ReturnType<typeof createNavigation> | null>(null);
  const lastIdentity = useRef(identity);
  useEffect(() => {
    if (lastIdentity.current !== identity && lastIdentity.current !== "anonymous") {
      // A new account/family starts at Home, with no previous page state.
      const url = new URL(location.href); url.hash = "";
      history.replaceState(null, "", url.href);
    }
    lastIdentity.current = identity;
    if (identity === "anonymous") return;
    let disposed = false;
    afterGuards(() => { if (!disposed) controller.current = createNavigation(identity, setVisit); });
    return () => { disposed = true; controller.current?.dispose(); controller.current = null; };
  }, [identity]);
  const navigate = useCallback((route: Route) => controller.current?.navigate(route), []);
  const replace = useCallback((route: Route) => controller.current?.replace(route), []);
  const back = useCallback(() => controller.current?.back(), []);
  const current = visit.scope === identity ? visit : { route: visit.scope === "anonymous" ? routeFromUrl(new URL(location.href)) : "hub" as Route, depth: 0 };
  return { route: current.route, depth: current.depth, navigate, replace, back };
}
