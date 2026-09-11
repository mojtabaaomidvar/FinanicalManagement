/* Use-caseهای بازار — قیمت طلا/ارز و شاخص بورس */

import type { MarketRepository } from "@/domain/market/market.repository";
import type { MarketSnapshot, StockSearch } from "@/domain/market/market.types";

export class GetMarketSnapshotUseCase {
  constructor(private readonly repo: MarketRepository) {}
  execute(): Promise<MarketSnapshot> {
    return this.repo.getSnapshot();
  }
}

/** جست‌وجوی نمادِ بورس. کوئریِ خیلی کوتاه را سرور با نتیجهٔ خالی جواب می‌دهد،
    پس این‌جا شرطِ اضافه نمی‌گذاریم و منطق در یک جا می‌ماند. */
export class SearchStocksUseCase {
  constructor(private readonly repo: MarketRepository) {}
  execute(query: string, limit?: number): Promise<StockSearch> {
    return this.repo.searchStocks(query, limit);
  }
}
