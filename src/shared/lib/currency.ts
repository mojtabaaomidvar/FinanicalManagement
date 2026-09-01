/* واحد پول — تومان پایه ذخیره‌سازی؛ تبدیل برای نمایش
   نرخ‌ها نسبت به تومان: ریال = ۱۰×تومان */

export type CurrencyCode = "تومان" | "ریال";

/** ضریب تبدیل مبلغ پایه (تومان) به واحد نمایش */
export function currencyFactor(currency: string | null | undefined): number {
  return currency === "ریال" ? 10 : 1;
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
