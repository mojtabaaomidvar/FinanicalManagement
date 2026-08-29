/* ═══════════════════════════════════════════════
   Service Worker — مالی من
   استراتژی: cache-first برای شل اپلیکیشن
   ═══════════════════════════════════════════════ */

const CACHE_NAME = "mali-man-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/config.js",
  "./js/jalali.js",
  "./js/sms-parser.js",
  "./js/db.js",
  "./js/charts.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

/* نصب: کش کردن شل */
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

/* فعال‌سازی: پاک کردن کش‌های قدیمی */
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* fetch: cache-first با fallback شبکه */
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request)
        .then((res) => {
          /* فقط پاسخ‌های هم‌مبدأ کش می‌شوند */
          if (
            res.ok &&
            new URL(e.request.url).origin === self.location.origin
          ) {
            const clone = res.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(() => {
          /* آفلاین و در کش نبود: صفحه اصلی */
          if (e.request.mode === "navigate") {
            return caches.match("./index.html");
          }
          return Response.error();
        });
    }),
  );
});
