/* انواع بازار — قیمت طلا/ارز و شاخص بورس (BrsApi از راه بک‌اند) */

export type MarketItem = {
  symbol: string;
  name: string;
  price: number;
  changeValue: number;
  changePercent: number;
  unit: string;
  date: string;
  time: string;
};

export type BourseIndex = {
  date: string;
  time: string;
  state: string;
  index: number;
  indexChange: number;
  indexChangePercent: number;
  indexEqualWeight: number;
  indexEqualWeightChange: number;
  marketValue: number; // mv — ریال
  tradesCount: number; // tno
  tradesVolume: number; // tvol
  tradesValue: number; // tval — ریال
};

export type MarketSnapshot = {
  updatedAt: string; // ISO
  stale: boolean;
  gold: MarketItem[];
  currency: MarketItem[];
  bourse: BourseIndex | null;
};
