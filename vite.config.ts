/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

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
        /* ناوبری به مسیرهای API نباید پوستهٔ نرم‌افزار را برگرداند. بدون این
           فهرست، باز کردنِ مستقیمِ یک آدرسِ API در مرورگر به‌جای پاسخِ سرور
           (یا خطای شفاف) صفحهٔ خانه‌یار را نشان می‌داد — که دیباگ را گمراه
           می‌کند. درخواست‌های fetch اصلاً mode: "navigate" ندارند، پس این
           قاعده روی کارِ خودِ نرم‌افزار اثری نمی‌گذارد. */
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            /* §۵.۲۷ و §۸.۵ — دادهٔ خانواده هرگز در کش نمی‌نشیند.
               این قاعده جایگزینِ قاعدهٔ قبلیِ `*.supabase.co` شد. آن الگو از
               زمانِ کوچِ بک‌اند به api.khaanehyar.ir دیگر هیچ درخواستی را
               نمی‌گرفت — یعنی محافظتی که در کانفیگ «دیده» می‌شد عملاً مرده
               بود و خواننده را به اشتباه مطمئن می‌کرد.

               تطبیق روی *مسیر* است نه میزبان، چون میزبان در زمانِ ساخت
               معلوم نیست: apiUrl.ts بر پایهٔ VITE_API_URL یا هم‌مبدأ («/api/v1»)
               یا مطلق (api.khaanehyar.ir) یا localhost می‌سازد. پیشوندِ
               «/api/v1/» تنها چیزی است که در هر سه حالت ثابت است.

               لنگرِ ^https?:// عمدی و لازم است: RegExpRoute برای درخواستِ
               cross-origin فقط وقتی تطبیق می‌دهد که تطابق از نویسهٔ صفرِ
               url.href شروع شود (workbox-routing/RegExpRoute.js). الگوی
               بی‌لنگرِ /\/api\/v1\// روی api.khaanehyar.ir بی‌صدا رد می‌شد. */
            urlPattern: /^https?:\/\/[^/]+\/api\/v1\//i,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
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
    port: 8000,
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
