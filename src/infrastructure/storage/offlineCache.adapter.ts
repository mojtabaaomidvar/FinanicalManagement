/* §۸.۵ — خروج، دادهٔ رمزنگاری‌شدهٔ حساب و کش‌های داده را پاک می‌کند.
   Precache سرویس‌ورکر فقط فایل‌های عمومی برنامه را دارد (src/sw.ts) و
   حفظ می‌شود تا پس از ورود دوباره، خرید و انبار بدون اینترنت باز شوند.
   localStorage برای تنظیمات دستگاه و سرویس‌ورکر برای به‌روزرسانی می‌مانند.
   شکست دسترسی به ذخیره‌ساز نباید مانع خروج شود. */

import type { OfflineCacheStore } from "@/domain/auth/auth.repository";
import { cacheNames } from "workbox-core/cacheNames.js";
import { setCacheNameDetails } from "workbox-core/setCacheNameDetails.js";

export class BrowserOfflineCache implements OfflineCacheStore {
  constructor(private readonly clearShopping?: () => Promise<void>) {}

  async clear(): Promise<void> {
    try { await this.clearShopping?.(); } catch { /* The cleared session prevents further cache access. */ }
    try {
      if (typeof caches === "undefined") return;
      let shellCache: string | undefined;
      try {
        const registration = typeof navigator !== "undefined"
          ? await navigator.serviceWorker?.getRegistration() : undefined;
        if (registration) {
          // Match Workbox's public naming policy in the worker's scope.
          setCacheNameDetails({ suffix: registration.scope });
          shellCache = cacheNames.precache;
        }
      } catch { /* Other caches are still removed if worker lookup fails. */ }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== shellCache).map((k) => caches.delete(k)));
    } catch {
      /* بی‌صدا — دلیلش در یادداشتِ بالای فایل */
    }
  }
}
