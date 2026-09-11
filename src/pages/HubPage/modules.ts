/* رجیستریِ ماژول‌های خانه — منبعِ یگانه‌ی کاشی‌های صفحه‌ی هاب.

   هر ماژول یا «فعال» است (به یک مسیرِ واقعی می‌رود) یا «به‌زودی»
   (خاکستری و غیرقابلِ لمس). قاعده: هیچ کاشیِ فعالی نباید به جایی
   برود که هنوز ساخته نشده — کاشی‌های آینده صراحتاً برچسبِ «به‌زودی»
   می‌گیرند تا وعده‌ی الکی ندهیم.

   tone فقط یک نامِ رنگ است؛ رنگِ واقعی در style.css از توکن‌های
   --t-<tone>-fg / --t-<tone>-bg خوانده می‌شود تا تمِ تیره هم درست کار کند. */

import type { Route } from "@/app/router";

export type ModuleTone =
  | "emerald"
  | "indigo"
  | "amber"
  | "rose"
  | "violet"
  | "teal"
  | "sky"
  | "lime";

export type HubModule = {
  id: string;
  title: string;
  /** زیرنویسِ ثابت؛ کاشی‌های فعال معمولاً زیرنویسِ زنده‌ی خودشان را دارند */
  sub?: string;
  icon: string;
  tone: ModuleTone;
  /** مقصد؛ اگر undefined باشد یعنی هنوز ساخته نشده (به‌زودی) */
  route?: Route;
};

/* ماژول‌های آماده‌ی امروز */
export const ACTIVE_MODULES: HubModule[] = [
  {
    id: "finance",
    title: "خرج و درآمد",
    icon: "i-swap",
    tone: "emerald",
    route: "dashboard",
  },
  {
    id: "transactions",
    title: "تراکنش‌ها",
    icon: "i-receipt",
    tone: "sky",
    route: "transactions",
  },
  {
    id: "accounts",
    title: "کیف پول",
    icon: "i-wallet",
    tone: "indigo",
    route: "accounts",
  },
  {
    id: "budgets",
    title: "بودجه‌ها",
    icon: "i-piggy",
    tone: "amber",
    route: "budgets",
  },
  {
    id: "market",
    title: "ارز و بورس",
    icon: "i-trend",
    tone: "rose",
    route: "market",
  },
  {
    id: "reports",
    title: "نمای کلی",
    icon: "i-chart",
    tone: "violet",
    route: "reports",
  },
  {
    id: "settings",
    title: "تنظیمات",
    sub: "اعضا، دسته‌ها، تم",
    icon: "i-gear",
    tone: "teal",
    route: "settings",
  },
];

/* نقشه‌ی راه — دیده می‌شوند تا مسیرِ محصول روشن باشد، ولی غیرفعال‌اند */
export const SOON_MODULES: HubModule[] = [
  { id: "bills", title: "قبوض و شارژ", icon: "i-bill", tone: "rose" },
  { id: "shopping", title: "لیست خرید", icon: "i-cart", tone: "lime" },
  { id: "calendar", title: "تقویم و مناسبت‌ها", icon: "i-clock", tone: "sky" },
  { id: "chores", title: "کارهای خانه", icon: "i-check", tone: "emerald" },
  { id: "docs", title: "اسناد خانه", icon: "i-briefcase", tone: "indigo" },
  { id: "meals", title: "برنامه‌ی غذایی", icon: "i-food", tone: "amber" },
];
