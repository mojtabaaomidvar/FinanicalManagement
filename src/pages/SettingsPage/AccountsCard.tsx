/* زیرصفحه «کارت‌ها و حساب‌ها»ی تنظیمات.
   این فایل عمداً پوسته‌ی نازکی روی features/accounts است: پیاده‌سازی
   قبلی یک نسخه‌ی جداگانه و ناهمگون بود (بدون موجودی، بدون تفکیک
   کیف‌پول، فرمِ افزودنِ محدودتر) و همان تفاوت‌ها باگ گزارش‌شده بود. */

import { AccountsFeature, useAccountsModel } from "@/features/accounts";

export function AccountsCard() {
  const m = useAccountsModel();
  return <AccountsFeature m={m} />;
}
