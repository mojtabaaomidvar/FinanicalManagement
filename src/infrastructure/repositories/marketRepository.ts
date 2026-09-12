/* مخزن بازار — اندپوینت REST بک‌اندِ اختصاصی (/market/prices).
   بک‌اند خودش BrsApi را با کش صدا می‌زند؛ کلید هرگز به کلاینت نمی‌رسد. */

import type { MarketRepository } from "@/domain/market/market.repository";
import type {
  BourseIndex,
  MarketItem,
  MarketSnapshot,
  Stock,
  StockSearch,
} from "@/domain/market/market.types";
import type { RestClient } from "@/infrastructure/api/restClient";

type ItemRow = {
  symbol: string;
  name: string;
  price: number;
  change_value: number;
  change_percent: number;
  unit: string;
  date: string;
  time: string;
};

type BourseRow = {
  date: string;
  time: string;
  state: string;
  index: number;
  index_change: number;
  index_change_percent: number;
  index_equalweight: number;
  index_equalweight_change: number;
  market_value: number;
  trades_count: number;
  trades_volume: number;
  trades_value: number;
};

type SnapshotRow = {
  updated_at: string;
  stale: boolean;
  gold: ItemRow[];
  currency: ItemRow[];
  /** اختیاری: سرورِ قدیمی‌تر این فیلد را نمی‌فرستد */
  crypto?: ItemRow[];
  bourse: BourseRow | null;
};

type StockRow = {
  symbol: string;
  name: string;
  price: number;
  change_percent: number;
  close_price: number;
  close_change_percent: number;
  volume: number;
  value: number;
  trades_count: number;
  low: number;
  high: number;
  yesterday: number;
  event_time: string;
  market: string;
};

type StockSearchRow = {
  query: string;
  fetched_at: string;
  stale: boolean;
  total: number;
  results: StockRow[];
};

function mapItem(r: ItemRow): MarketItem {
  return {
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    changeValue: r.change_value,
    changePercent: r.change_percent,
    unit: r.unit,
    date: r.date,
    time: r.time,
  };
}

function mapBourse(r: BourseRow): BourseIndex {
  return {
    date: r.date,
    time: r.time,
    state: r.state,
    index: r.index,
    indexChange: r.index_change,
    indexChangePercent: r.index_change_percent,
    indexEqualWeight: r.index_equalweight,
    indexEqualWeightChange: r.index_equalweight_change,
    marketValue: r.market_value,
    tradesCount: r.trades_count,
    tradesVolume: r.trades_volume,
    tradesValue: r.trades_value,
  };
}

function mapStock(r: StockRow): Stock {
  return {
    symbol: r.symbol,
    name: r.name,
    price: r.price,
    changePercent: r.change_percent,
    closePrice: r.close_price,
    closeChangePercent: r.close_change_percent,
    volume: r.volume,
    value: r.value,
    tradesCount: r.trades_count,
    low: r.low,
    high: r.high,
    yesterday: r.yesterday,
    eventTime: r.event_time,
    market: r.market,
  };
}

export class RestMarketRepository implements MarketRepository {
  constructor(private readonly client: RestClient) {}

  async getSnapshot(): Promise<MarketSnapshot> {
    const r = await this.client.get<SnapshotRow>("/market/prices");
    return {
      updatedAt: r.updated_at,
      stale: r.stale,
      gold: (r.gold ?? []).map(mapItem),
      currency: (r.currency ?? []).map(mapItem),
      crypto: (r.crypto ?? []).map(mapItem),
      bourse: r.bourse ? mapBourse(r.bourse) : null,
    };
  }

  async searchStocks(query: string, limit?: number): Promise<StockSearch> {
    // RestClient.get پارامترِ query نمی‌گیرد، پس رشته را خودمان می‌چسبانیم
    // (encode لازم است: نمادها فارسی‌اند).
    const qs = `?q=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`;
    const r = await this.client.get<StockSearchRow>(`/market/stocks${qs}`);
    return {
      query: r.query,
      fetchedAt: r.fetched_at,
      stale: r.stale,
      total: r.total,
      results: (r.results ?? []).map(mapStock),
    };
  }
}
