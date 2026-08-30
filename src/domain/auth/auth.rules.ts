/* قوانین احراز هویت — نرمال‌سازی و اعتبارسنجی (خالص) */

import { toEn } from "@/shared/lib/digits";

/** نرمال‌سازی شماره ایرانی → 09xxxxxxxxx (نامعتبر → "")
    ارقام فارسی/عربی هم پذیرفته می‌شوند */
export function normalizePhone(input: string): string {
  if (!input) return "";
  /* اول ارقام فارسی/عربی → انگلیسی، بعد حذف نویسه‌های اضافه */
  let s = toEn(String(input)).replace(/[^\d+]/g, "");
  if (s.startsWith("+98")) s = "0" + s.slice(3);
  else if (s.startsWith("0098")) s = "0" + s.slice(4);
  else if (s.startsWith("98") && s.length === 12) s = "0" + s.slice(2);
  return /^09\d{9}$/.test(s) ? s : "";
}

export const MIN_PASSWORD_LENGTH = 4;

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** کد OTP: دقیقاً ۶ رقم */
export function isValidOtpCode(code: string): boolean {
  return /^\d{6}$/.test(cleanOtpCode(code));
}

export function cleanOtpCode(code: string): string {
  return toEn(code).replace(/\D/g, "");
}
