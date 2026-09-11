/* مسیرهای اپ — ناوبری سبک بدون کتابخانه (تاریخچه پشتیبانی می‌شود)

   از بازطراحیِ «هابِ خانه» به بعد، مسیرِ آغازین "hub" است:
   صفحه‌ی خانه شبکه‌ی کاشیِ ماژول‌هاست و "dashboard" (خرج و درآمد)
   خودش یکی از ماژول‌های داخلِ آن شبکه است. */

export type Route =
  | "auth"
  | "invite"
  | "hub"
  | "dashboard"
  | "transactions"
  | "reports"
  | "accounts"
  | "budgets"
  | "settings";

export const MAIN_ROUTES: Route[] = [
  "hub",
  "dashboard",
  "transactions",
  "reports",
  "accounts",
  "budgets",
  "settings",
];
