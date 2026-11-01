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

/** رشتهٔ عددیِ کاربر → شکل استاندارد انگلیسی با **نقطهٔ** اعشار.
 *
 * ٫ (U+066B) جداکنندهٔ اعشار فارسی است و به نقطه تبدیل می‌شود؛ ولی
 * ٬ (U+066C) و ، (U+060C) جداکنندهٔ هزارند و باید حذف شوند — اگر این دو
 * را هم اعشار می‌گرفتیم، «۱٬۲۰۰» به‌جای ۱۲۰۰ عدد ۱٫۲ خوانده می‌شد.
 *
 * این تابع تا ۱۴۰۵/۰۷/۲۱ خصوصیِ `domain/holding/holding.rules.ts` بود و
 * به این‌جا آمد چون ورودیِ تعدادِ §۱.۸ هم همین را لازم داشت: نسخهٔ دستیِ
 * دومی که نوشتم `٫` را نمی‌شناخت و «۱٫۵» را **۱۵** می‌خواند. جایِ درستش
 * همین فایل است، کنارِ toFa/toEn که خودِ `٫` را تولید می‌کنند.
 *
 * علامتِ منفی هم دور انداخته می‌شود؛ فراخوان اگر منفی برایش معنا دارد
 * باید **پیش از** صدا‌زدنِ این تابع آن را ببیند.
 */
export function normalizeNumeric(raw: string | number): string {
  return toEn(String(raw))
    .replace(/٫/g, ".") // ٫ اعشار فارسی → نقطه
    .replace(/[٬،,\s_]/g, "") // ٬ ، و کاما/فاصله: جداکنندهٔ هزار
    .replace(/[^\d.]/g, ""); // هر چیز دیگر
}
