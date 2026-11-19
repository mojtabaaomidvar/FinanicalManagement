/* مسیرهای اپ — ناوبری سبک بدون کتابخانه (تاریخچه پشتیبانی می‌شود)

   از بازطراحی «هاب خانه» به بعد، مسیر آغازین "hub" است:
   صفحه‌ی خانه شبکه‌ی کاشی ماژول‌هاست و "dashboard" (خرج و درآمد)
   خودش یکی از ماژول‌های داخل آن شبکه است. */

export type Route =
  | "auth"
  | "invite"
  | "hub"
  | "sections"
  | "notifications"
  | "sms"
  | "dashboard"
  | "transactions"
  | "reports"
  | "accounts"
  | "budgets"
  | "bills"
  | "calendar"
  | "shopping"
  | "inventory"
  | "tasks"
  | "documents"
  | "meals"
  | "equipment"
  | "vehicles"
  | "goals"
  | "activities"
  | "children"
  | "pets"
  | "market"
  | "settings";

export const MAIN_ROUTES: Route[] = [
  "hub",
  "sections",
  "notifications",
  "sms",
  "dashboard",
  "transactions",
  "reports",
  "accounts",
  "budgets",
  "bills",
  "calendar",
  "shopping",
  "inventory",
  "tasks",
  "documents",
  "meals",
  "equipment",
  "vehicles",
  "goals",
  "activities",
  "children",
  "pets",
  "market",
  "settings",
];
