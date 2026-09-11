/* صفحه بازار — شاخص بورس + جست‌وجوی تک‌سهم + قیمت لحظه‌ای طلا و ارز.

   داده با هوکِ مشترکِ features/market می‌آید (همان که زیرنویسِ کاشیِ هاب را
   می‌سازد)؛ refresh کشِ کلاینت را دور می‌زند، سرور تا ۵ دقیقه کش می‌کند.
   تغییرِ قیمت‌ها با رنگ/علامت نشان داده می‌شود (مثبت = سبزِ اکسنت، منفی = قرمز).

   جست‌وجوی سهم: فیلتر روی سرور انجام می‌شود (چند هزار نماد به گوشی نمی‌آید) و
   قیمتِ برگشتی همان لحظه‌ای است که سرور فهرست را گرفته — ساعتش صریح نمایش
   داده می‌شود تا کاربر «قیمتِ زنده» فرض نکند. */

import { useState } from "react";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { useMarket, useStockSearch } from "@/features/market";
import {
  changeTone,
  formatClock,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  toHemat,
} from "@/domain/market/market.rules";
import type {
  BourseIndex,
  MarketItem,
  Stock,
} from "@/domain/market/market.types";

export function MarketPage() {
  const { data, error, loading, refresh } = useMarket();

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>ارز و بورس</h1>
          <p>
            {data
              ? `به‌روزرسانی ${toFa(data.bourse?.time ?? data.gold[0]?.time ?? "")}${
                  data.stale ? " · ممکن است قدیمی باشد" : ""
                }`
              : "قیمت لحظه‌ای طلا، ارز و شاخص بورس"}
          </p>
        </div>
        <button
          type="button"
          className="market-refresh"
          aria-label="به‌روزرسانی"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <Icon name="i-repeat" size={20} />
        </button>
      </header>

      <div className="content">
        {loading && !data ? (
          <div className="loading-block">
            <span className="spinner" />
            در حال دریافت قیمت‌ها…
          </div>
        ) : null}

        {error && !data ? (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Icon name="i-alert" size={28} />
            </span>
            <p>{error}</p>
            <button type="button" className="btn-secondary" onClick={() => void refresh()}>
              تلاش دوباره
            </button>
          </div>
        ) : null}

        {data ? (
          <>
            {data.bourse ? <BourseCard b={data.bourse} /> : null}

            <StockSearchSection />

            {data.currency.length ? (
              <section className="market-section">
                <h2 className="market-h2">ارز</h2>
                <div className="market-list">
                  {data.currency.map((it) => (
                    <PriceRow key={it.symbol} it={it} />
                  ))}
                </div>
              </section>
            ) : null}

            {data.gold.length ? (
              <section className="market-section">
                <h2 className="market-h2">طلا و سکه</h2>
                <div className="market-list">
                  {data.gold.map((it) => (
                    <PriceRow key={it.symbol} it={it} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

/* کارت شاخص بورس — کل، هم‌وزن و آمار بازار */
function BourseCard({ b }: { b: BourseIndex }) {
  const tone = changeTone(b.indexChange);
  return (
    <div className="market-bourse">
      <div className="market-bourse-head">
        <div>
          <p className="market-bourse-label">شاخص کل بورس تهران</p>
          <b className="market-bourse-index" dir="ltr">
            {formatAmount(b.index)}
          </b>
        </div>
        <span
          className={`market-change is-${tone}`}
          dir="ltr"
        >
          {formatSigned(b.indexChange)} ({formatSignedPercent(b.indexChangePercent)})
        </span>
      </div>

      <div className="market-bourse-grid">
        <div>
          <span>شاخص هم‌وزن</span>
          <b dir="ltr">{formatAmount(b.indexEqualWeight)}</b>
          <small className={`market-change is-${changeTone(b.indexEqualWeightChange)}`} dir="ltr">
            {formatSignedPercent(b.indexEqualWeightChange)}
          </small>
        </div>
        <div>
          <span>ارزش بازار</span>
          <b dir="ltr">{formatAmount(toHemat(b.marketValue))} همت</b>
        </div>
        <div>
          <span>ارزش معاملات</span>
          <b dir="ltr">{formatAmount(toHemat(b.tradesValue))} همت</b>
        </div>
        <div>
          <span>حجم معاملات</span>
          <b>{formatCompact(b.tradesVolume)} سهم</b>
        </div>
      </div>

      <p className="market-bourse-meta">
        وضعیت بازار: {b.state || "—"} · {toFa(b.date)}
      </p>
    </div>
  );
}

/* یک ردیف قیمت — از راست: نام | قیمت + واحد | درصدِ تغییر (بلوکِ عددی LTR است) */
function PriceRow({ it }: { it: MarketItem }) {
  const tone = changeTone(it.changePercent);
  return (
    <div className="market-row">
      <span className="market-row-name">{it.name}</span>
      <span className="market-row-side">
        <span className={`market-change is-${tone}`} dir="ltr">
          {formatSignedPercent(it.changePercent)}
        </span>
        <b className="market-row-price" dir="ltr">
          {formatAmount(it.price)}
          <small>{it.unit}</small>
        </b>
      </span>
    </div>
  );
}

/* جست‌وجوی تک‌سهم — تایپ کن، سرور فیلتر می‌کند */
function StockSearchSection() {
  const { query, setQuery, data, error, loading, clear, minChars } = useStockSearch();
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const typed = query.trim().length;
  const clock = data ? formatClock(data.fetchedAt) : "";

  return (
    <section className="market-section">
      <h2 className="market-h2">جست‌وجوی سهم</h2>

      <div className="market-search">
        <span className="market-search-icon" aria-hidden="true">
          <Icon name="i-search" size={18} />
        </span>
        <input
          type="search"
          className="market-search-input"
          placeholder="نماد یا نامِ شرکت — مثلِ فولاد"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenSymbol(null);
          }}
          aria-label="جست‌وجوی نمادِ بورس"
          enterKeyHint="search"
        />
        {typed ? (
          <button
            type="button"
            className="market-search-clear"
            aria-label="پاک‌کردن"
            onClick={clear}
          >
            <Icon name="i-x" size={16} />
          </button>
        ) : null}
      </div>

      {/* حالت‌ها عمداً همه پوشش داده شده‌اند تا کاربر هرگز جعبه‌ی خالیِ بی‌توضیح نبیند */}
      {typed > 0 && typed < minChars ? (
        <p className="market-search-hint">
          برای جست‌وجو دستِ‌کم {toFa(String(minChars))} حرف بنویسید.
        </p>
      ) : null}

      {loading ? (
        <p className="market-search-hint">
          <span className="spinner" /> در حال جست‌وجو…
        </p>
      ) : null}

      {error ? <p className="market-search-hint is-error">{error}</p> : null}

      {!loading && !error && data && typed >= minChars ? (
        data.results.length ? (
          <>
            <p className="market-search-meta">
              {clock ? `قیمت‌ها در ساعتِ ${clock}` : "قیمت‌های آخرین دریافت"}
              {data.stale ? " · ممکن است قدیمی باشد" : ""}
              {data.total > data.results.length
                ? ` · ${toFa(String(data.results.length))} از ${toFa(String(data.total))} نتیجه`
                : ""}
            </p>
            <div className="market-list">
              {data.results.map((s, i) => (
                <StockRow
                  key={`${s.symbol}-${i}`}
                  s={s}
                  open={openSymbol === s.symbol}
                  onToggle={() =>
                    setOpenSymbol(openSymbol === s.symbol ? null : s.symbol)
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <p className="market-search-hint">نمادی با این نام پیدا نشد.</p>
        )
      ) : null}
    </section>
  );
}

/* ردیفِ نتیجهٔ جست‌وجو — لمسِ ردیف جزئیاتِ تابلو را باز/بسته می‌کند */
function StockRow({
  s,
  open,
  onToggle,
}: {
  s: Stock;
  open: boolean;
  onToggle: () => void;
}) {
  const tone = changeTone(s.changePercent);
  return (
    <div className={`market-stock${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="market-stock-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="market-stock-id">
          <b className="market-stock-symbol">{s.symbol}</b>
          <small className="market-stock-name">{s.name}</small>
        </span>
        <span className="market-row-side">
          <span className={`market-change is-${tone}`} dir="ltr">
            {formatSignedPercent(s.changePercent)}
          </span>
          <b className="market-row-price" dir="ltr">
            {formatAmount(s.price)}
            <small>ریال</small>
          </b>
        </span>
      </button>

      {open ? (
        <div className="market-stock-detail">
          <div>
            <span>قیمتِ پایانی</span>
            <b dir="ltr">{formatAmount(s.closePrice)}</b>
            <small className={`market-change is-${changeTone(s.closeChangePercent)}`} dir="ltr">
              {formatSignedPercent(s.closeChangePercent)}
            </small>
          </div>
          <div>
            <span>دیروز</span>
            <b dir="ltr">{formatAmount(s.yesterday)}</b>
          </div>
          <div>
            <span>کم‌ترین روز</span>
            <b dir="ltr">{formatAmount(s.low)}</b>
          </div>
          <div>
            <span>بیش‌ترین روز</span>
            <b dir="ltr">{formatAmount(s.high)}</b>
          </div>
          <div>
            <span>حجمِ معاملات</span>
            <b>{formatCompact(s.volume)} سهم</b>
          </div>
          <div>
            <span>ارزشِ معاملات</span>
            <b dir="ltr">{formatAmount(toHemat(s.value))} همت</b>
          </div>
          <div>
            <span>تعدادِ معاملات</span>
            <b>{formatCompact(s.tradesCount)}</b>
          </div>
          <div>
            <span>بازار</span>
            <b>{s.market || "—"}</b>
          </div>
        </div>
      ) : null}
    </div>
  );
}
