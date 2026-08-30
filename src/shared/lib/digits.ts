/* ارقام فارسی/انگلیسی — تبدیل دوطرفه */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function toFa(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA_DIGITS[+d]);
}

export function toEn(value: string | number): string {
  return String(value)
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

/* فقط رقم‌های انگلیسی از متن (ارقام فارسی/عربی هم تبدیل می‌شوند) */
export function digitsOnly(value: string): string {
  return toEn(value).replace(/\D/g, "");
}
