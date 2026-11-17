/* رجیستری ماژول‌های خانه — منبع یگانه‌ی کاشی‌های صفحه‌ی هاب.

   هر ماژول یا «فعال» است (به یک مسیر واقعی می‌رود) یا «به‌زودی»
   (خاکستری و غیرقابل لمس). قاعده: هیچ کاشی فعالی نباید به جایی
   برود که هنوز ساخته نشده — کاشی‌های آینده صراحتاً برچسب «به‌زودی»
   می‌گیرند تا وعده‌ی الکی ندهیم.

   tone فقط یک نام رنگ است؛ رنگ واقعی در style.css از توکن‌های
   --t-<tone>-fg / --t-<tone>-bg خوانده می‌شود تا تم تیره هم درست کار کند. */

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
  /** زیرنویس ثابت؛ کاشی‌های فعال معمولاً زیرنویس زنده‌ی خودشان را دارند */
  sub?: string;
  icon?: string;
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
    id: "bills",
    title: "قبوض و شارژ",
    icon: "i-bill",
    tone: "rose",
    route: "bills",
  },
  {
    id: "calendar",
    title: "تقویم و مناسبت‌ها",
    icon: "i-clock",
    tone: "sky",
    route: "calendar",
  },
  {
    id: "shopping",
    title: "لیست خرید",
    icon: "i-cart",
    tone: "lime",
    route: "shopping",
  },
  {
    id: "inventory",
    title: "انبار خانه",
    icon: "i-grid4",
    tone: "teal",
    route: "inventory",
  },
  {
    id: "market",
    title: "ارز و بورس",
    icon: "i-trend",
    tone: "rose",
    route: "market",
  },
  {
    id: "chores",
    title: "کارهای خانه",
    icon: "i-check",
    tone: "emerald",
    route: "tasks",
  },
  {
    id: "reports",
    title: "نمای کلی",
    icon: "i-chart",
    tone: "violet",
    route: "reports",
  },
  {
    id: "docs",
    title: "اسناد خانه",
    sub: "اسناد خصوصی و مشترک",
    icon: "i-briefcase",
    tone: "indigo",
    route: "documents",
  },
  {
    id: "meals",
    title: "برنامهٔ غذایی",
    sub: "وعده‌های هفته و مواد لازم برای خرید",
    icon: "i-food",
    tone: "amber",
    route: "meals",
  },
  {
    id: "equipment",
    title: "وسایل خانه",
    sub: "گارانتی و سرویس‌های دوره‌ای",
    icon: "i-grid4",
    tone: "teal",
    route: "equipment",
  },
  {
    id: "vehicles",
    title: "خودرو و نگهداری",
    sub: "سرویس، مدارک و هزینه‌های خودرو",
    icon: "i-car",
    tone: "sky",
    route: "vehicles",
  },
  {
    id: "goals",
    title: "اهداف و آرزوهای شخصی",
    sub: "هدف‌ها، آرزوها و موعدهای خصوصی من",
    icon: "i-heart",
    tone: "violet",
    route: "goals",
  },
  {
    id: "activities",
    title: "تفریح و برنامه‌های خانوادگی",
    sub: "برنامه‌ها، شرکت‌کنندگان و یادآورها",
    icon: "i-fun",
    tone: "rose",
    route: "activities",
  },
  {
    id: "children",
    title: "فرزندان و برنامه‌های آن‌ها",
    sub: "مشخصات، کارها، برنامه‌ها و تولد",
    icon: "i-users",
    tone: "lime",
    route: "children",
  },
  {
    id: "pets",
    title: "حیوانات خانگی و مراقبت از آن‌ها",
    sub: "مشخصات، کارهای مراقبتی و موعدها",
    icon: "i-paw",
    tone: "amber",
    route: "pets",
  },
];

/* نقشه‌ی راه — دیده می‌شوند تا مسیر محصول روشن باشد، ولی غیرفعال‌اند.
   «قبوض و شارژ» و «تقویم و مناسبت‌ها» و «لیست خرید»/«انبار خانه» از این
   فهرست به ACTIVE_MODULES رفتند (۱۴۰۵/۰۷/۱۸ و ۱۴۰۵/۰۷/۱۹ و ۱۴۰۵/۰۷/۲۱). */
export const SOON_MODULES: HubModule[] = [];
