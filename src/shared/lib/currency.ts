/* واحد پول — تومان پایه ذخیره‌سازی؛ تبدیل برای نمایش
   نرخ‌ها نسبت به تومان: ریال = ۱۰×تومان */

export type CurrencyCode = "تومان" | "ریال";

/** ضریب تبدیل مبلغ پایه (تومان) به واحد نمایش */
export function currencyFactor(currency: string | null | undefined): number {
  return currency === "ریال" ? 10 : 1;
}

/** نامِ واحد برای نوشتن در سرستون/برچسب — همیشه کنارِ currencyFactor بماند.
    دلیلِ وجودش: currencyFactor هر چیزی جز "ریال" را تومان می‌گیرد (از جمله
    null و رشتهٔ خالی). اگر برچسب را جای دیگری با `${cur}` می‌ساختیم، برای
    cur === null سرستون «مبلغ ()» می‌شد و فایلِ خروجی واحدش را نمی‌گفت —
    یعنی ضریب و برچسب دو مرجعِ جدا می‌داشتند و می‌توانستند ناهم‌خوان شوند. */
export function currencyLabel(currency: string | null | undefined): string {
  return currencyFactor(currency) === 10 ? "ریال" : "تومان";
}

/** تبدیل مبلغ تومانی → مقدار نمایشی در واحد فعلی */
export function toDisplay(amountInToman: number, currency: string | null | undefined): number {
  return amountInToman * currencyFactor(currency);
}

/** تبدیل مقدار ورودی کاربر در واحد فعلی → تومان (برای ذخیره) */
export function fromDisplay(amount: number, currency: string | null | undefined): number {
  const f = currencyFactor(currency);
  return f === 1 ? amount : Math.round(amount / f);
}
