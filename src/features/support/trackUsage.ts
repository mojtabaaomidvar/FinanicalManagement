import type { Route } from "@/app/router";
import { getContainer } from "@/infrastructure/repositories/container";
import { RestClient } from "@/infrastructure/api/restClient";

const trackedRoutes = new Set<Route>(["dashboard", "transactions", "accounts", "budgets", "bills", "reports",
  "calendar", "shopping", "inventory", "tasks", "documents", "meals", "equipment", "vehicles",
  "goals", "activities", "children", "pets", "market", "settings", "notifications"]);

/** Navigation count only. No account/member IDs, record data or persisted queue. */
export async function recordUsageOpen(route: Route): Promise<void> {
  if (!trackedRoutes.has(route) || !navigator.onLine) return;
  try {
    const container = await getContainer();
    await new RestClient(container.session).post<void>("/usage/open", { module: route });
  } catch { /* Analytics does not block the household UI or its offline workflows. */ }
}
