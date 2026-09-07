/* نسخه برنامه — تا انتشار عمومی نسخه اصلی ۰ است؛ عدد دوم شمارنده انتشار است
   (هر انتشار: +۱) */

export const APP_VERSION = "0.3";

/* ── شناسه ساخت ──────────────────────────────────────────────────────
   عدد نسخه دستی است و یادمان می‌رود جلو ببریمش؛ آن‌وقت بعد از یک انتشار
   موفق هم صفحه تنظیمات همان عدد قبلی را نشان می‌دهد و آدم فکر می‌کند
   آپدیت نشده. این شناسه از زمان build می‌آید، پس هر انتشار خودبه‌خود
   یکتاست و می‌شود با یک نگاه فهمید نسخه روی دستگاه تازه است یا نه.
   __BUILD_TIME__ را vite.config.ts تزریق می‌کند. */

export const BUILD_TIME: string =
  typeof __BUILD_TIME__ === "string" ? __BUILD_TIME__ : "";

/** شناسه کوتاه ساخت مثل «۲۰۲۶۰۹۰۵-۱۳۵۵» (به وقت محلی دستگاه) */
export function buildId(): string {
  if (!BUILD_TIME) return "dev";
  const d = new Date(BUILD_TIME);
  if (Number.isNaN(d.getTime())) return "dev";
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}`
  );
}

/** نسخه کامل برای نمایش/گزارش خطا — مثل «0.3+20260905-1355» */
export function fullVersion(): string {
  return `${APP_VERSION}+${buildId()}`;
}
