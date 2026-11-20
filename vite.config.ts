/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";
import { copySourcePlugin } from "./scripts/copy-workbench/instrument.mjs";
import { supportBrandingPlugin } from "./scripts/support-branding-plugin";

/* شناسه ساخت — هر بار که build اجرا شود عوض می‌شود، پس هر انتشار
   خودبه‌خود یکتاست و لازم نیست یادتان باشد عدد نسخه را دستی جلو ببرید.
   زمان به UTC ذخیره می‌شود و موقع نمایش به وقت محلی کاربر درمی‌آید. */
const BUILD_TIME = new Date().toISOString();

export default defineConfig(({ mode }) => {
  const isLocalSandbox = mode === "local-sandbox" || mode === "copy-workbench";
  return {
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    // محیط تست همیشه از پروکسی محلی استفاده می‌کند، حتی با وجود .env.local تولید.
    ...(isLocalSandbox ? {
      "import.meta.env.VITE_API_URL": JSON.stringify(""),
      "import.meta.env.VITE_SUPPORT_HOST": JSON.stringify(""),
      "import.meta.env.VITE_APP_URL": JSON.stringify(""),
    } : {}),
  },
  plugins: [
    ...(mode === "copy-workbench" ? [copySourcePlugin()] : []),
    react(),
    ...(isLocalSandbox
      ? [{
          name: "local-sandbox-title",
          transformIndexHtml: (html: string) => html.replace(
            /<title>.*?<\/title>/,
            "<title>خانه‌یار — محیط تست محلی</title>",
          ),
        }]
      : []),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
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
      // The custom worker retains shell-only caching and runs the encrypted outbox.
      injectManifest: { globPatterns: ["**/*.{js,css,html,png,svg,woff2}"] },
    }),
    supportBrandingPlugin(),
  ],
  ...(!isLocalSandbox ? {
    build: { rollupOptions: { input: {
      app: fileURLToPath(new URL("./index.html", import.meta.url)),
      support: fileURLToPath(new URL("./support.html", import.meta.url)),
    } } },
  } : {}),
  /* سرور توسعه — ویندوز بازه‌ی ۴۹۳۲ تا ۵۶۵۷ را برای Hyper-V/WSL رزرو کرده،
     پس پورت پیش‌فرض ویت (۵۱۷۳) خطای EACCES می‌دهد. ۵۷۰۰ بیرون آن بازه است.
     host:true یعنی روی IP شبکه‌ی محلی هم گوش می‌دهد تا بشود اپ را
     مستقیم روی گوشی باز کرد (این اپ موبایل‌محور است).

     proxy: در وب محلی، apiUrl.ts آدرس نسبی «/api/v1» می‌سازد؛ بدون پروکسی
     این درخواست به خود سرور ویت می‌خورَد و ۴۰۴ می‌دهد. اینجا به بک‌اند
     واقعی فوروارد می‌شود. چون فوروارد سمت سرور ویت (Node) انجام می‌شود،
     نه مرورگر، اصلاً CORS در کار نیست و لازم نیست چیزی روی VPS عوض شود.
     توجه: این یعنی دادهٔ واقعی تولید — هر تراکنشی که موقع تست ثبت کنی
     واقعاً ثبت می‌شود. */
  server: {
    port: isLocalSandbox ? 5700 : 8000,
    host: isLocalSandbox ? "127.0.0.1" : true,
    strictPort: isLocalSandbox,
    proxy: {
      "/api/v1": {
        target: isLocalSandbox ? "http://127.0.0.1:5800" : "https://api.khaanehyar.ir",
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
  };
});
