/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { devApiPlugin } from "./scripts/dev-api";

/* شناسه ساخت — هر بار که build اجرا شود عوض می‌شود، پس هر انتشار
   خودبه‌خود یکتاست و لازم نیست یادتان باشد عدد نسخه را دستی جلو ببرید.
   زمان به UTC ذخیره می‌شود و موقع نمایش به وقت محلی کاربر درمی‌آید. */
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  plugins: [
    react(),
    devApiPlugin(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-maskable-512.png",
        "khaneyar-mark.svg",
      ],
      manifest: {
        name: "خانه یار — دستیار مالی خانواده",
        short_name: "خانه یار",
        description: "دستیار مالی خانواده",
        dir: "rtl",
        lang: "fa",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0b0d12",
        theme_color: "#0b0d12",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  /* سرورِ توسعه — ویندوز بازه‌ی ۴۹۳۲ تا ۵۶۵۷ را برای Hyper-V/WSL رزرو کرده،
     پس پورتِ پیش‌فرضِ ویت (۵۱۷۳) خطای EACCES می‌دهد. ۵۷۰۰ بیرونِ آن بازه است.
     host:true یعنی روی IP شبکه‌ی محلی هم گوش می‌دهد تا بشود اپ را
     مستقیم روی گوشی باز کرد (این اپ موبایل‌محور است).

     proxy: در وبِ محلی، apiUrl.ts آدرسِ نسبیِ «/api/v1» می‌سازد؛ بدونِ پروکسی
     این درخواست به خودِ سرورِ ویت می‌خورَد و ۴۰۴ می‌دهد. اینجا به بک‌اندِ
     واقعی فوروارد می‌شود. چون فوروارد سمتِ سرورِ ویت (Node) انجام می‌شود،
     نه مرورگر، اصلاً CORS در کار نیست و لازم نیست چیزی روی VPS عوض شود.
     توجه: این یعنی دادهٔ واقعیِ تولید — هر تراکنشی که موقعِ تست ثبت کنی
     واقعاً ثبت می‌شود. */
  server: {
    port: 5700,
    host: true,
    proxy: {
      "/api/v1": {
        target: "https://api.khaanehyar.ir",
        changeOrigin: true,
        secure: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
