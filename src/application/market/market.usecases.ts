/* Use-caseهای بازار — قیمت طلا/ارز و شاخص بورس */

import type { MarketRepository } from "@/domain/market/market.repository";
import type { MarketSnapshot } from "@/domain/market/market.types";

export class GetMarketSnapshotUseCase {
  constructor(private readonly repo: MarketRepository) {}
  execute(): Promise<MarketSnapshot> {
    return this.repo.getSnapshot();
  }
}
