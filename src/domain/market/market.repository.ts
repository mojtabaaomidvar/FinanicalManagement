/* اینترفیس مخزن بازار — پیاده‌سازی در infrastructure/repositories */

import type { MarketSnapshot, StockSearch } from "./market.types";

export interface MarketRepository {
  /** اسنپ‌شات کش‌شدهٔ سمت سرور: طلا + ارز + شاخص بورس */
  getSnapshot(): Promise<MarketSnapshot>;

  /** جست‌وجوی تک‌سهم — فیلتر سمتِ سرور روی فهرستِ کشِ‌شدهٔ نمادها */
  searchStocks(query: string, limit?: number): Promise<StockSearch>;
}
