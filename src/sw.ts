/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";
import { createSecureStorage } from "./infrastructure/storage/secureStorage.adapter";
import { createShoppingOffline, SHOPPING_SYNC_TAG } from "./infrastructure/offline/shoppingOffline";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision?: string | null }>;
};

// Only the application shell enters CacheStorage; authenticated API responses do not.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), {
  denylist: [/^\/api\//],
}));
for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
  registerRoute(({ url }) => url.pathname.startsWith("/api/v1/"), new NetworkOnly(), method);
}

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

interface ShoppingSyncEvent extends ExtendableEvent { tag: string }

self.addEventListener("sync", ((event: ShoppingSyncEvent) => {
  if (event.tag !== SHOPPING_SYNC_TAG) return;
  event.waitUntil((async () => {
    const storage = await createSecureStorage();
    if (!storage.persistent) return;
    const engine = createShoppingOffline(storage);
    try {
      if (!await engine.loadScope()) return;
      const state = await engine.sync();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) client.postMessage({ type: "SHOPPING_OFFLINE_CHANGED" });
      // Reject transient delivery failures so the browser keeps its retry schedule.
      if (state.offline && state.pending.some((entry) => entry.status === "pending")) {
        throw new Error("Shopping changes still await a connection.");
      }
    } finally {
      engine.dispose();
    }
  })());
}) as EventListener);
