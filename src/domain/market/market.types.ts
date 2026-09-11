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

/** یک نمادِ بورس/فرابورس — قیمتِ همان لحظه‌ای که سرور از بالادست گرفته */
export type Stock = {
  symbol: string; // نمادِ معاملاتی، مثلِ «فولاد»
  name: string; // نامِ کاملِ شرکت
  price: number; // آخرین معامله
  changePercent: number;
  closePrice: number; // قیمتِ پایانی
  closeChangePercent: number;
  volume: number; // حجمِ معاملات
  value: number; // ارزشِ معاملات (ریال)
  tradesCount: number;
  low: number; // کمترین قیمتِ روز
  high: number; // بیشترین قیمتِ روز
  yesterday: number; // قیمتِ دیروز
  eventTime: string; // ساعتِ آخرین رویداد روی تابلو (خامِ بالادست)
  market: string; // بورس / فرابورس / …
};

/** نتیجهٔ جست‌وجوی نماد — فیلتر روی سرور انجام شده، این فقط چند ردیفِ بالا است */
export type StockSearch = {
  query: string;
  /** ISO — لحظه‌ای که سرور فهرست را از بالادست گرفته؛ UI کنارِ قیمت نشانش می‌دهد */
  fetchedAt: string;
  stale: boolean;
  /** تعدادِ کلِ تطبیق‌ها روی سرور، پیش از بُرشِ limit */
  total: number;
  results: Stock[];
};
