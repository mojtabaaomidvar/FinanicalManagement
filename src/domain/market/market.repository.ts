/* اینترفیس مخزن بازار — پیاده‌سازی در infrastructure/repositories */

import type { MarketSnapshot } from "./market.types";

export interface MarketRepository {
  /** اسنپ‌شات کش‌شدهٔ سمت سرور: طلا + ارز + شاخص بورس */
  getSnapshot(): Promise<MarketSnapshot>;
}
