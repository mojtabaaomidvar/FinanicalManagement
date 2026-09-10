/* بازنشسته در فاز ۹ (سوییچِ کامل و تمیز).
   ────────────────────────────────────────────────────────────────────────
   این ماژول «API_BASE» را می‌ساخت: در اپ نیتیو آدرسِ مطلقِ دپلوی Vercel و در وب
   رشتهٔ خالی (نسبی)، برای رساندنِ درخواست‌ها به توابعِ سرورلس. با مهاجرت به بک‌اندِ
   اختصاصی، مبدأِ واحد به «shared/config/apiUrl» (API_URL + absoluteApiUrl) منتقل شد.
   تنها مصرف‌کننده‌ها httpClient (بازنشسته) و SmsBridgeCard (به absoluteApiUrl سوییچ شد)
   بودند؛ دیگر هیچ importی باقی نیست. طبق قاعدهٔ «حذف نکن، بازنشسته کن»، بدنهٔ قبلی در
   تاریخچهٔ گیت می‌ماند و این فایل عمداً خالی نگه داشته می‌شود.

   کدِ قدیمی (مرجع):
     export const API_BASE = Capacitor.isNativePlatform()
       ? (import.meta.env.VITE_API_BASE || "https://…vercel.app") : "";
     export function isNativeApp() { return Capacitor.isNativePlatform(); }
   ──────────────────────────────────────────────────────────────────────── */

export {};
