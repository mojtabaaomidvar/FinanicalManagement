import type { AnalyticsModule, ProductReport } from "./analytics.types";

export const moduleLabels: Record<AnalyticsModule, string> = {
  dashboard: "داشبورد مالی", transactions: "تراکنش‌ها", accounts: "کیف پول‌ها", budgets: "بودجه‌ها",
  bills: "قبوض و شارژ", reports: "گزارش‌ها", calendar: "تقویم و مناسبت‌ها", shopping: "لیست خرید",
  inventory: "انبار خانه", tasks: "کارهای خانه", documents: "اسناد خانه", meals: "برنامهٔ غذایی",
  equipment: "وسایل خانه", vehicles: "خودرو", goals: "اهداف و آرزوها", activities: "برنامه‌های خانوادگی",
  children: "فرزندان", pets: "حیوانات خانگی", market: "بازار", settings: "تنظیمات", notifications: "اعلان‌ها",
};
export const recordLabels: Record<keyof ProductReport["record_inventory"], string> = {
  wallets: "کیف پول و حساب", budget_limits: "سقف بودجهٔ ثبت‌شده", bills: "قبض ثبت‌شده", inventory_items: "قلم انبار",
  shopping_items: "قلم خرید", meal_dishes: "غذای ثبت‌شده", meal_entries: "وعدهٔ برنامه‌ریزی‌شده", equipment: "وسیلهٔ خانه",
  vehicles: "خودروی ثبت‌شده", maintenance_records: "سابقهٔ سرویس", calendar_events: "رویداد تقویم",
  goals: "هدف و آرزو", pets: "پروفایل حیوان خانگی", bank_messages: "پیامک بانکی دریافت‌شده",
};
export const stageLabels = {
  sms: "تحلیل پیامک و متن مالی", assistant_analyze: "تحلیل دستیار خانه",
  assistant_plan: "برنامه‌ریزی دستیار", assistant_report: "گزارش دستیار",
};
export const snapshotLabels: Record<keyof ProductReport["snapshot"], string> = {
  families: "خانوادهٔ ثبت‌شده", families_with_accounts: "خانواده دارای حساب ثبت‌نام‌کامل",
  profiles: "مجموع پروفایل‌ها", registered_accounts: "حساب ثبت‌نام‌کامل", introduced_profiles: "معرفی‌شده؛ ثبت‌نام ناتمام",
  managed_profiles: "پروفایل بدون حساب مستقل", active_accounts: "حساب با عضویت فعال",
  pending_accounts: "حساب در انتظار تأیید", inactive_accounts: "حساب با عضویت غیرفعال",
  accounts_with_login: "حساب با ورود موفق در بازه", families_with_login: "خانواده با ورود موفق در بازه",
  accounts_without_login_history: "حساب بدون سابقهٔ ورود", accounts_without_registration_history: "حساب بدون تاریخ تکمیل ثبت‌نام",
};
export const countLabels: Record<keyof NonNullable<ProductReport["records"]>, string> = {
  transactions: "تراکنش معمولی", scheduled_plans: "برنامهٔ مالی تکرارشونده", open_tasks: "کار باز",
  completed_tasks: "کار انجام‌شده", shopping_lists: "لیست خرید", documents: "سند ثبت‌شده",
};
export const excelLabels = {
  guide: "راهنمای فایل", snapshot: "خانواده و حساب", daily: "روند روزانه", modules: "همهٔ بخش‌ها",
  counts: "حجم داده", usage: "جمع فعالیت", errors: "خطاهای ورود", measurement: "پوشش اندازه‌گیری",
  aiTotals: "جمع مصرف AI", aiStages: "همهٔ مسیرهای AI", overview: "سلامت و منابع", services: "سرویس‌ها",
  users: "کاربران", backups: "پشتیبان‌ها", releases: "نسخه‌ها", jobs: "عملیات", audit: "سابقهٔ دسترسی",
  accounts: "مدیران", logs: "لاگ‌ها", field: "شاخص", value: "مقدار", status: "وضعیت داده", key: "کلید فنی",
  measured: "ثبت‌شده", zero: "صفر ثبت‌شده", unknown: "اندازه‌گیری‌نشده", empty: "بدون داده",
  failed: "دریافت ناموفق", yes: "بله", no: "خیر", notReported: "اعلام‌نشده",
  generated: "زمان ساخت فایل", checked: "زمان گزارش", start: "آغاز بازه", days: "بازه، روز",
  source: "گزارش", allRows: "ردیف‌های صفر و بدون داده نیز صادر شده‌اند؛ فهرست‌ها شامل همهٔ صفحات قابل دریافت‌اند.",
  limits: "فقط داده‌های مجاز همین نقش؛ کلید، رمز، متن خانواده و محتوای فایل‌های خصوصی صادر نمی‌شوند.",
  live: "منابع جداگانه خوانده می‌شوند؛ این فایل snapshot اتمیک دیتابیس نیست. دادهٔ نامعلوم صفر نیست.",
  opens: "بازشدن", requests: "درخواست موفق", creates: "ایجاد", updates: "ویرایش", completes: "انجام یا تسویه", deletes: "حذف",
  successes: "پاسخ معتبر", failures: "ناموفق", input: "توکن ورودی اعلام‌شده", output: "توکن خروجی اعلام‌شده",
  inputRequests: "فراخوانی با ورودی معلوم", outputRequests: "فراخوانی با خروجی معلوم", calls: "فراخوانی سرویس AI",
  day: "روز میلادی تهران", newFamilies: "خانوادهٔ جدید", registrations: "تکمیل ثبت‌نام", authErrors: "خطای ورود و ثبت‌نام",
  website: "بازدید سایت معرفی", unique: "کاربر فعال یکتا", retention: "بازگشت کاربران", duration: "مدت استفاده",
  oldAssistant: "اندازه‌گیری دستیار در قرارداد قدیمی؛ مصرف AI در برگهٔ مستقل است",
  firstUsage: "اولین شمارندهٔ استفاده", firstError: "اولین شمارندهٔ خطا", firstAi: "اولین شمارندهٔ AI",
  loginErrors: "خطای ورود", registrationErrors: "خطای ثبت‌نام", serverErrors: "خطای سرور از همین خطاها", totalErrors: "مجموع خطاها",
  lifetimeOpens: "بازشدن از اولین شمارنده", lifetimeRequests: "درخواست از اولین شمارنده",
  api: "وضعیت API", database: "وضعیت دیتابیس", softwareVersion: "نسخهٔ برنامه", apiVersion: "نسخهٔ اعلامی API", managementVersion: "نسخهٔ مدیریت",
  cpu: "بار پردازنده؛ درصد نیست", cores: "تعداد هسته", ramUsed: "رم مصرف‌شده، بایت", ramTotal: "کل رم، بایت",
  diskUsed: "دیسک مصرف‌شده، بایت", diskTotal: "کل دیسک، بایت", uptime: "زمان روشن‌بودن، ثانیه",
  identifier: "شناسه", role: "نقش", phone: "شمارهٔ پوشیده", created: "زمان ایجاد", lastLogin: "آخرین ورود",
  bytes: "حجم، بایت", image: "تصویر سرویس", hash: "SHA-256", version: "نسخه", fetched: "زمان دریافت",
  actor: "مدیر", operation: "عملیات", target: "مقصد", finished: "زمان پایان", message: "پیام نتیجه", safetyBackup: "پشتیبان حفاظتی",
  event: "رخداد", username: "نام کاربری مدیریت", enabled: "فعال", mfa: "دومرحله‌ای", service: "سرویس", line: "خط", logText: "متن پالایش‌شده",
  scheduled: "پشتیبان روزانه", returned: "تعداد ردیف دریافتی", expected: "تعداد اعلام‌شدهٔ فهرست",
  exportChanged: "داده‌های گزارش هنگام دریافت تغییر کردند؛ دوباره دریافت کنید.",
  exportIncomplete: "یکی از صفحه‌های گزارش کامل نیست؛ فایل کامل صادر نشد.",
};
