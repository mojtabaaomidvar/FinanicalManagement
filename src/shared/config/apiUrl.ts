/* آدرسِ پایهٔ API — تنها مبدأِ همهٔ درخواست‌ها (فاز ۹: سوییچِ کامل و تمیز به بک‌اندِ اختصاصی).
   جایگزینِ کانفیگِ دوگانهٔ apiBase + supabase است. دیگر مسیرِ مستقیمِ Supabase و پروکسیِ
   سرورلس وجود ندارد؛ چون بک‌اند داخلِ ایران میزبانی می‌شود، ترفندِ عبور از مسدودیِ
   supabase.co لازم نیست.

   حلِ آدرس:
   - VITE_API_URL ست شده → همان (مبدأِ بک‌اند، بدونِ اسلشِ انتهایی) + «/api/v1».
   - ست نشده:
       • نیتیو (Capacitor): WebView روی localhost اجرا می‌شود، پس آدرسِ مطلقِ توسعه
         «http://localhost:8000/api/v1» (uvicornِ محلی). برای انتشار باید VITE_API_URL ست شود.
       • وب: مبدأِ نسبی «/api/v1» (هم‌مبدأ؛ مناسبِ زمانی که فرانت و API پشتِ یک
         reverse-proxy روی یک دامنه‌اند). هیچ URLِ تولیدِ هاردکد وجود ندارد. */

import { Capacitor } from "@capacitor/core";

const API_PREFIX = "/api/v1";

function resolveApiUrl(): string {
  const raw = (import.meta.env.VITE_API_URL ?? "").trim().replace(/\/+$/, "");
  if (raw) return raw + API_PREFIX;
  if (Capacitor.isNativePlatform()) return "http://localhost:8000" + API_PREFIX;
  return API_PREFIX;
}

/** مبدأِ API شاملِ پیشوندِ نسخه — مثلاً «https://api.example.com/api/v1» یا «/api/v1». */
export const API_URL = resolveApiUrl();

/** نسخهٔ «مطلقِ» API — برای جاهایی که باید URLِ کامل به کاربر/سرویسِ بیرونی نشان داده شود
    (مثلِ آدرسِ webhookِ فورواردرِ پیامک). اگر API_URL نسبی باشد، مبدأِ صفحه به آن افزوده می‌شود. */
export function absoluteApiUrl(): string {
  if (API_URL.startsWith("http")) return API_URL;
  const origin = typeof location !== "undefined" ? location.origin : "";
  return origin + API_URL;
}
