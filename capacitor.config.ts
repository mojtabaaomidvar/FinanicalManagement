import type { CapacitorConfig } from "@capacitor/cli";

/* OTA: WebView مستقیم نسخه‌ی دپلوی‌شده را لود می‌کند → هر deploy وب
   (scp dist → khaanehyar.ir) در اجرای بعدی اپ خودکار اعمال می‌شود، بدون بازساخت APK.
   بسته‌ی محلی dist همچنان به‌عنوان fallback در APK هست (وقتی server.url
   حذف شود). اپ آنلاین-فقط است (داده‌ها روی سرور) پس نیاز اینترنت عیب نیست. */
// بازنشسته ۲۰۲۶-۰۹-۱۰: میزبانیِ قبلی روی vercel بود؛ حالا سرورِ اختصاصیِ ایران (khaanehyar.ir).
// const APP_URL = "https://finanical-management.vercel.app";
const APP_URL = "https://khaanehyar.ir";

const config: CapacitorConfig = {
  appId: "ir.khaneyar.app",
  appName: "خانه یار",
  webDir: "dist",
  server: {
    url: APP_URL,
    androidScheme: "https",
  },
};

export default config;
