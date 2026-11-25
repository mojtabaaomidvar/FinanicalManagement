import type { OperationKind, Role } from "./api";

export const pageLabels = {
  overview: "نمای کلی", analytics: "آمار و بهبود محصول", server: "سرور و سرویس‌ها", users: "کاربران", settings: "تنظیمات برنامه",
  backups: "پشتیبان‌ها", releases: "نسخه‌ها", logs: "لاگ سرویس‌ها", accounts: "مدیران و دسترسی‌ها", history: "سابقهٔ عملیات",
};
export type Page = keyof typeof pageLabels;
export const roleLabels: Record<Role, string> = { owner: "مالک", operator: "مدیر عملیات", viewer: "ناظر" };
export const serviceLabels: Record<string, string> = { api: "سرویس برنامه", db: "پایگاه داده", nginx: "وب‌سرور" };
export const stateLabels: Record<string, string> = {
  running: "در حال اجرا", active: "فعال", exited: "متوقف", inactive: "متوقف", missing: "نصب نشده", unknown: "نامشخص",
  restarting: "در حال راه‌اندازی", created: "ساخته شده", dead: "متوقف", available: "در دسترس", unavailable: "از دسترس خارج",
  suspended: "تعلیق‌شده", pending: "در انتظار تأیید", removed: "عضویت پایان‌یافته", rejected: "ردشده", expired: "منقضی‌شده",
  queued: "در صف", succeeded: "انجام شد", failed: "ناموفق", interrupted: "قطع‌شده",
};
export const actionLabels: Record<OperationKind, string> = {
  "service.start": "شروع سرویس", "service.stop": "توقف سرویس", "service.restart": "راه‌اندازی مجدد سرویس",
  "nginx.reload": "بررسی و بارگذاری وب‌سرور", "certificate.renew": "تمدید گواهی‌های امنیتی",
  "host.reboot": "راه‌اندازی مجدد سرور", "host.cancel_reboot": "لغو راه‌اندازی مجدد سرور",
  "backup.create": "ساخت پشتیبان کامل", "backup.verify": "بررسی یکپارچگی پشتیبان", "backup.restore": "بازیابی پشتیبان",
  "backup.schedule": "تنظیم پشتیبان روزانه", "release.fetch": "دریافت و بررسی نسخه", "release.install": "نصب نسخه",
  "settings.update": "ذخیرهٔ تنظیمات", "user.suspend": "تعلیق حساب", "user.activate": "رفع تعلیق حساب", "user.revoke_sessions": "پایان همهٔ نشست‌های کاربر",
};
export const actionDescriptions: Record<OperationKind, string> = {
  "service.start": "سرویس انتخاب‌شده شروع می‌شود. وضعیت پس از اجرا دوباره بررسی می‌شود.",
  "service.stop": "سرویس انتخاب‌شده متوقف می‌شود. توقف دیتابیس، سرویس برنامه را هم متوقف می‌کند.",
  "service.restart": "سرویس برای مدت کوتاهی از دسترس خارج می‌شود. با راه‌اندازی مجدد دیتابیس، برنامه نیز دوباره شروع می‌شود.",
  "nginx.reload": "ابتدا تنظیمات وب‌سرور بررسی و در صورت معتبر بودن، بارگذاری می‌شوند.",
  "certificate.renew": "گواهی‌های نزدیک انقضا تمدید و تنظیمات وب‌سرور دوباره بارگذاری می‌شوند.",
  "host.reboot": "سرور یک دقیقه بعد راه‌اندازی مجدد می‌شود. برنامه و این پنل تا بالا آمدن سرور در دسترس نخواهند بود.",
  "host.cancel_reboot": "درخواست زمان‌بندی‌شدهٔ راه‌اندازی مجدد سرور لغو می‌شود.",
  "backup.create": "برنامه برای ثبت یک نسخهٔ سازگار از دیتابیس، فایل‌ها، تنظیمات و تصویر برنامه، کوتاه‌مدت متوقف می‌شود.",
  "backup.verify": "هش همهٔ فایل‌های این پشتیبان بررسی می‌شود. اطلاعات فعلی برنامه تغییر نمی‌کند.",
  "backup.restore": "ابتدا از وضعیت فعلی پشتیبان گرفته می‌شود؛ سپس دیتابیس، فایل‌ها، تنظیمات و نسخهٔ برنامه با پشتیبان انتخابی جایگزین می‌شوند.",
  "backup.schedule": "پشتیبان کامل روزانه ساعت ۲ بامداد به وقت UTC فعال یا غیرفعال می‌شود. پشتیبان‌های موجود حفظ می‌شوند.",
  "release.fetch": "بسته از انتشار رسمی خانه‌یار دریافت و هش و ساختار آن بررسی می‌شود. نصب در مرحلهٔ جدا انجام می‌شود.",
  "release.install": "ابتدا پشتیبان کامل ساخته می‌شود؛ سپس نصب‌کنندهٔ بررسی‌شده، برنامه و رابط وب را به‌روز می‌کند.",
  "settings.update": "تنظیمات انتخاب‌شده اعمال می‌شوند. تغییر درگاه‌ها می‌تواند سرویس برنامه را کوتاه‌مدت راه‌اندازی مجدد کند.",
  "user.suspend": "دسترسی این حساب متوقف و همهٔ نشست‌های آن باطل می‌شوند. اطلاعات حساب حفظ می‌شود.",
  "user.activate": "تعلیق این حساب برداشته می‌شود. کاربر برای ورود دوباره باید احراز هویت کند.",
  "user.revoke_sessions": "همهٔ نشست‌های ورود این کاربر باطل می‌شوند. ورود دوباره با رمز حساب ممکن است.",
};
export const flagLabels: Record<string, string> = {
  maintenance: "حالت تعمیرات", registration_enabled: "ثبت‌نام و پیوستن حساب تازه", assistant_enabled: "دستیار هوشمند", otp_enabled: "کد پیامکی ورود",
};
export const environmentLabels: Record<string, string> = {
  SMS_PROVIDER: "درگاه پیامک", SMS_API_KEY: "کلید درگاه پیامک", SMS_SENDER: "فرستندهٔ پیامک", SMS_TEMPLATE: "قالب کد پیامکی",
  DEEPSEEK_API_KEY: "کلید سرویس هوش مصنوعی", AI_SMS_MODEL: "مدل دستیار", AI_SMS_GATEWAY_URL: "نشانی درگاه دستیار", AI_SMS_GATEWAY_TOKEN: "کلید اتصال درگاه دستیار",
};
export const secretKeys = new Set(["SMS_API_KEY", "DEEPSEEK_API_KEY", "AI_SMS_GATEWAY_TOKEN"]);
export const ownerOperations = new Set<OperationKind>(["backup.restore", "release.install", "host.reboot", "host.cancel_reboot"]);
export const sensitiveOperations = new Set<OperationKind>(["backup.restore", "release.install", "host.reboot", "service.stop"]);
export const auditLabels: Record<string, string> = {
  "account.created": "ساخت حساب مدیریت", "account.updated": "تغییر حساب مدیریت", "session.login": "ورود مدیر", "session.logout": "خروج مدیر",
  "operation.queued": "ثبت درخواست عملیات", "operation.succeeded": "پایان موفق عملیات", "operation.failed": "عملیات ناموفق", "backup.download": "دریافت پشتیبان",
};
