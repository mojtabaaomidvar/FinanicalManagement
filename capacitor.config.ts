import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "ir.khaneyar.app",
  appName: "خانه یار",
  webDir: "dist",
  /* اپ نیتیو از WebView روی localhost اجرا می‌شود؛ درخواست‌های API باید
     مطلق باشند (API_BASE در src/shared/config/apiBase.ts) */
  server: {
    androidScheme: "https",
  },
};

export default config;
