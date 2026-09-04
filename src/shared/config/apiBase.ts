/* آدرس پایه توابع سرورless — فقط در اپ نیتیو (Capacitor) لازم است
   مرورگر: "" یعنی همان دامنه (نسبی) — رفتار وب دست‌نخورده می‌ماند
   اپ نیتیو: WebView روی localhost است؛ باید مطلق به دپلوی Vercel برود */

import { Capacitor } from "@capacitor/core";

export const API_BASE = Capacitor.isNativePlatform()
  ? (import.meta.env.VITE_API_BASE || "https://finanical-management.vercel.app")
  : "";

/** اجرا داخل اپ نیتیو اندروید/iOS؟ */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
