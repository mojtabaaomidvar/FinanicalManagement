/* مسیرهای اپ — ناوبری سبک بدون کتابخانه (تاریخچه پشتیبانی می‌شود) */

export type Route =
  | "auth"
  | "invite"
  | "dashboard"
  | "transactions"
  | "reports"
  | "accounts"
  | "settings";

export const MAIN_ROUTES: Route[] = [
  "dashboard",
  "transactions",
  "reports",
  "accounts",
  "settings",
];
