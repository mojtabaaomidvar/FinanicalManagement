/* صفحه بازار — شاخص بورس + قیمت لحظه‌ای طلا و ارز (BrsApi از راه بک‌اند).

   داده با هوکِ مشترکِ features/market می‌آید (همان که زیرنویسِ کاشیِ هاب را
   می‌سازد)؛ refresh کشِ کلاینت را دور می‌زند، سرور تا ۵ دقیقه کش می‌کند.
   تغییرِ قیمت‌ها با رنگ/علامت نشان داده می‌شود (مثبت = سبزِ اکسنت، منفی = قرمز). */

import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { useMarket } from "@/features/market";
import {
  changeTone,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  toHemat,
} from "@/domain/market/market.rules";
import type { BourseIndex, MarketItem } from "@/domain/market/market.types";

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
            <button type="button" className="btn-outline" onClick={() => void refresh()}>
              تلاش دوباره
            </button>
          </div>
        ) : null}

        {data ? (
          <>
            {data.bourse ? <BourseCard b={data.bourse} /> : null}

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
