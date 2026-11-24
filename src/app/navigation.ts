import { MAIN_ROUTES, type Route } from "./router";
import { afterGuards, isGuardPop, observeGuardHistory, requestBack } from "@/shared/lib/backGuard";

type Visit = { scope: string; route: Route; depth: number };
const stateKey = "khaneyarNavigation";
export function routeFromUrl(url: URL): Route {
  const candidate = url.hash.replace(/^#\/?/, "") || url.pathname.replace(/^\/|\/$/g, "");
  return MAIN_ROUTES.includes(candidate as Route) ? candidate as Route : "hub";
}
export function routeParent(route: Route): Route {
  if (["transactions", "reports", "accounts", "budgets"].includes(route)) return "dashboard";
  return route === "sections" || route === "dashboard" || route === "settings" || route === "notifications" ? "hub" : "sections";
}
function readVisit(state: unknown, scope: string): Visit | null {
  const value = (state as Record<string, unknown> | null)?.[stateKey] as Visit | undefined;
  return value?.scope === scope && MAIN_ROUTES.includes(value.route) && Number.isInteger(value.depth) && value.depth >= 0 ? value : null;
}
function routeUrl(route: Route) {
  const url = new URL(location.href);
  url.hash = route === "hub" ? "" : `/${route}`;
  return url.href;
}

/** Browser history is the sole visit stack; local state contains only its current entry. */
export function createNavigation(scope: string, changed: (visit: Visit) => void) {
  observeGuardHistory();
  let disposed = false;
  let visit = readVisit(history.state, scope);
  const write = (route: Route, depth: number, replace: boolean) => {
    visit = { scope, route, depth };
    const { backGuard: _guard, k: _k, ...state } = history.state ?? {};
    history[replace ? "replaceState" : "pushState"]({ ...state, [stateKey]: visit }, "", routeUrl(route));
    changed(visit);
  };
  if (!visit) {
    const route = routeFromUrl(new URL(location.href));
    write(route === "hub" ? "hub" : routeParent(route), 0, true);
    if (route !== "hub") write(route, 1, false);
  } else changed(visit);
  history.scrollRestoration = "manual";
  const pop = (event: PopStateEvent) => {
    // Guard listeners can run before or after this listener. Inspect after dispatch.
    queueMicrotask(() => {
      if (disposed || isGuardPop(event)) return;
      const target = readVisit(event.state, scope);
      if (target) { visit = target; changed(target); }
      else write("hub", 0, true); // Never resurrect another member's navigation.
    });
  };
  window.addEventListener("popstate", pop);
  return {
    navigate(route: Route) {
      if (route === visit!.route) return;
      afterGuards(() => { if (!disposed && route !== visit!.route) write(route, visit!.depth + 1, false); });
    },
    replace(route: Route) {
      afterGuards(() => { if (!disposed) write(route, visit!.depth, true); });
    },
    back() {
      if (requestBack()) return;
      if (visit!.depth > 0) history.back();
      else if (visit!.route !== "hub") write(routeParent(visit!.route), 0, true);
    },
    dispose() { disposed = true; window.removeEventListener("popstate", pop); },
  };
}
