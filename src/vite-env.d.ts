/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** مبدأِ بک‌اندِ اختصاصی (بدونِ پیشوندِ /api/v1) — اگر ست نشود، مبدأِ نسبی/پیش‌فرض
      استفاده می‌شود. تنها متغیرِ محیطیِ فعالِ شبکه پس از فاز ۹. */
  readonly VITE_API_URL?: string;
  /* بازنشسته (فاز ۹): VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY دیگر خوانده نمی‌شوند؛
     پس از تکمیلِ مهاجرت باید از محیط حذف و کلیدها چرخانده شوند (فاز ۱ — سمتِ کاربر). */
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** زمان build به ISO (UTC) — از vite.config.ts تزریق می‌شود */
declare const __BUILD_TIME__: string;
