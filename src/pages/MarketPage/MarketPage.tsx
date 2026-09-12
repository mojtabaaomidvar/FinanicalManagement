/* صفحه بازار — شبکه‌ی چهار کاشی (بورس، طلا، ارز، رمزارز) + زیرصفحه‌ی هر دسته.

   چیدمان: صفحه‌ی اصلی فقط چهار کاشی است؛ لمسِ هر کاشی زیرصفحه‌ی کاملِ همان
   دسته را باز می‌کند. پیش‌تر همه‌ی فهرست‌ها پشتِ سرِ هم در یک اسکرول بودند و
   رسیدن به «رمزارز» یعنی رد کردنِ ۲۰ ردیفِ ارز؛ حالا هر دسته یک لمس فاصله دارد.

   زیرنویسِ کاشی عمداً «تعداد» نیست بلکه شاخصِ همان دسته است (دلار، سکه،
   بیت‌کوین، شاخصِ کل) — «۲۳ مورد» چیزی به کاربر نمی‌گوید، ولی قیمتِ دلار
   اغلب همان چیزی است که کاربر برایش آمده و بدون هیچ لمسی دیده می‌شود.

   بازگشت: زیرصفحه با useBackGuard به دکمه‌ی فیزیکی/سوایپِ اندروید وصل است،
   پس بازگشت از زیرصفحه به شبکه می‌رسد نه بیرونِ صفحه‌ی بازار.

   داده با هوکِ مشترکِ features/market می‌آید (همان که زیرنویسِ کاشیِ هاب را
   می‌سازد)؛ refresh کشِ کلاینت را دور می‌زند، سرور تا ۵ دقیقه کش می‌کند. */

import { useState } from "react";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { useMarket, useStockSearch } from "@/features/market";
import { AddHoldingModal, useHoldings } from "@/features/holdings";
import type { HoldingTarget } from "@/features/holdings";
import { findHolding, formatQuantity } from "@/domain/holding/holding.rules";
import type { HoldingKind } from "@/domain/holding/holding.types";
import {
  changeTone,
  findDollar,
  formatClock,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  toHemat,
  toToman,
  usdToman,
} from "@/domain/market/market.rules";
import type {
  BourseIndex,
  MarketItem,
  MarketSnapshot,
  Stock,
} from "@/domain/market/market.types";
import { MarketSubPage } from "./MarketSubPage";

/** شناسه‌ی دسته — همان کلیدی که زیرصفحه را انتخاب می‌کند */
type CatId = "bourse" | "gold" | "currency" | "crypto";

/* دستهٔ صفحه → نوعِ دارایی. فقط «بورس» نامش فرق دارد؛ بقیه یکی‌اند ولی
   نگاشتِ صریح نوشته شده تا اگر روزی دسته‌ای اضافه شد، TypeScript همین‌جا
   خطا بدهد نه در زمانِ اجرا. */
const HOLDING_KIND: Record<CatId, HoldingKind> = {
  bourse: "stock",
  gold: "gold",
  currency: "currency",
  crypto: "crypto",
};

/* ردیفِ بازار → هدفِ افزودن.

   قیمت این‌جا به تومان تبدیل می‌شود چون اسنپ‌شات واحدِ خامِ بالادست را
   می‌دهد (رمزارز اغلب دلار، سهم ریال) ولی سرور ارزشِ دارایی را همیشه به
   تومان برمی‌گرداند. بدونِ این تبدیل، عددِ پیش‌نمایشِ مودال با عددی که یک
   لحظه بعد در «دارایی‌ها» می‌نشیند فرق می‌کرد — برای سهم دقیقاً ۱۰ برابر.
   واحد هم «تومان» ذخیره می‌شود تا ردیفِ بی‌قیمت (که واحدِ ذخیره‌شده را
   نشان می‌دهد) برچسبِ متناقض نگیرد. */
function itemTarget(kind: HoldingKind, it: MarketItem, usd: number): HoldingTarget {
  return {
    kind,
    symbol: it.symbol,
    name: it.name,
    unit: "تومان",
    price: toToman(it.price, it.unit, usd),
  };
}

function stockTarget(s: Stock): HoldingTarget {
  // تابلوی بورس همیشه ریال است؛ نرخِ دلار در این مسیر بی‌ربط است.
  return {
    kind: "stock",
    symbol: s.symbol,
    name: s.name,
    unit: "تومان",
    price: toToman(s.price, "ریال", 0),
  };
}

type Cat = {
  id: CatId;
  title: string;
  icon: string;
  tone: string;
};

/* یک منبعِ واحد برای عنوان/آیکون/رنگ — کاشی و زیرصفحه هر دو از این می‌خوانند
   تا عنوانِ کاشی و عنوانِ زیرصفحه هیچ‌وقت از هم جدا نیفتند. */
const CATS: Cat[] = [
  { id: "bourse", title: "بورس تهران", icon: "i-chart", tone: "rose" },
  { id: "gold", title: "طلا و سکه", icon: "i-crown", tone: "amber" },
  { id: "currency", title: "ارز", icon: "i-swap", tone: "sky" },
  // آیکونِ رمزارز در اسپرایت نیست؛ i-grid4 خنثی‌ترین گزینه است.
  { id: "crypto", title: "رمزارز", icon: "i-grid4", tone: "violet" },
];

/* ZWNJ (نیم‌فاصله) را برمی‌دارد تا «بیت‌کوین» و «بیت کوین» یکی شمرده شوند.
   بالادست هر دو املا را دیده‌ایم، پس تطبیقِ خام شکننده است. */
function norm(s: string): string {
  return s.replace(/‌/g, "").replace(/\s+/g, "");
}

/** موردِ شاخصِ یک دسته برای زیرنویسِ کاشی؛ اگر پیدا نشد، اولین مورد. */
function featured(items: MarketItem[], names: string[]): MarketItem | null {
  if (!items.length) return null;
  for (const want of names) {
    const hit = items.find((it) => norm(it.name).includes(norm(want)));
    if (hit) return hit;
  }
  return items[0];
}

/** آیتم‌های یک دسته از اسنپ‌شات */
function itemsOf(data: MarketSnapshot, id: CatId): MarketItem[] {
  if (id === "gold") return data.gold;
  if (id === "currency") return data.currency;
  if (id === "crypto") return data.crypto;
  return [];
}

export function MarketPage() {
  const { data, error, loading, refresh } = useMarket();
  const holdings = useHoldings();
  const [open, setOpen] = useState<CatId | null>(null);
  const [target, setTarget] = useState<HoldingTarget | null>(null);

  // بازگشتِ اندروید باید زیرصفحه را ببندد، نه از صفحه‌ی بازار بیرون بزند.
  useBackGuard(open !== null, () => setOpen(null));

  /* نرخِ دلار از همان اسنپ‌شات: تنها راهِ تومانی‌کردنِ ردیف‌هایی که
     بالادست به دلار قیمت زده (اغلب رمزارز). نبودش یعنی آن ردیف‌ها
     بی‌قیمت نشان داده می‌شوند، نه با عددِ غلط. */
  const usd = data ? usdToman(data.currency) : 0;

  /* ردیفِ ثبت‌شدهٔ همین قلم (اگر باشد) — همان چیزی که مودال را از حالتِ
     «افزودن» به «ویرایش» می‌برد. */
  const existing = target
    ? findHolding(holdings.items, target.kind, target.symbol, target.name)
    : undefined;

  const pick = (t: HoldingTarget) => {
    /* خطای مانده از تلاشِ قبلی نباید بالای فرمِ تازه ظاهر شود. */
    holdings.clearError();
    setTarget(t);
  };

  const submit = async (quantity: number) => {
    if (!target) return;
    const ok = existing
      ? await holdings.update({ id: existing.id, quantity })
      : await holdings.add({
          kind: target.kind,
          symbol: target.symbol,
          name: target.name,
          unit: target.unit,
          quantity,
        });
    // فقط در موفقیت می‌بندیم؛ در خطا مودال باز می‌ماند تا پیام دیده شود.
    if (ok) setTarget(null);
  };

  /* مودال در هر دو شاخه (شبکه و زیرصفحه) رندر می‌شود. ردیف‌های قیمت فقط
     در زیرصفحه‌اند و این کامپوننت برای آن شاخه return زودهنگام دارد، پس
     اگر مودال را فقط در return پایانی می‌گذاشتیم هیچ‌وقت باز نمی‌شد. */
  const sheet = (
    <AddHoldingModal
      target={target}
      existingQuantity={existing?.quantity}
      busy={holdings.busy}
      error={holdings.error}
      onClose={() => setTarget(null)}
      onSubmit={(q) => void submit(q)}
    />
  );

  /** آیا این قلم قبلاً در دارایی‌ها هست؟ — برای نشانِ «دارید» روی ردیف */
  const heldQuantity = (kind: HoldingKind, symbol: string, name: string) =>
    findHolding(holdings.items, kind, symbol, name)?.quantity;

  const refreshBtn = (
    <button
      type="button"
      className="market-refresh"
      aria-label="به‌روزرسانی"
      onClick={() => void refresh()}
      disabled={loading}
    >
      <Icon name="i-repeat" size={20} />
    </button>
  );

  /* زیرصفحه — فقط وقتی داده هست. اگر کاربر زیرصفحه باز کرده باشد و refresh
     شکست بخورد data صفر نمی‌شود (هوک داده‌ی قبلی را نگه می‌دارد)، ولی این
     گارد از حالتِ لبه‌ایِ «باز بود و داده پاک شد» هم محافظت می‌کند. */
  if (open && data) {
    const cat = CATS.find((c) => c.id === open)!;
    const kind = HOLDING_KIND[open];
    return (
      <>
        <MarketSubPage
          title={cat.title}
          onBack={() => setOpen(null)}
          action={refreshBtn}
        >
          {open === "bourse" ? (
            <>
              {data.bourse ? <BourseCard b={data.bourse} /> : null}
              <StockSearchCard
                onPick={(s) => pick(stockTarget(s))}
                heldOf={(s) => heldQuantity("stock", s.symbol, s.name)}
              />
            </>
          ) : (
            <PriceListCard
              items={itemsOf(data, open)}
              onPick={(it) => pick(itemTarget(kind, it, usd))}
              heldOf={(it) => heldQuantity(kind, it.symbol, it.name)}
            />
          )}
        </MarketSubPage>
        {sheet}
      </>
    );
  }

  return (
    <>
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
        {refreshBtn}
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
          <div className="market-grid">
            {CATS.map((c) => (
              <CatTile
                key={c.id}
                cat={c}
                data={data}
                onOpen={() => setOpen(c.id)}
              />
            ))}
          </div>
        ) : null}
      </div>
      </section>
      {sheet}
    </>
  );
}

/* کاشیِ یک دسته — عنوان + آیکونِ رنگی + زیرنویسِ زنده.
   کاشیِ بی‌داده غیرفعال می‌شود تا لمسش زیرصفحه‌ی خالی باز نکند. */
function CatTile({
  cat,
  data,
  onOpen,
}: {
  cat: Cat;
  data: MarketSnapshot;
  onOpen: () => void;
}) {
  const info = tileInfo(cat.id, data);

  if (!info) {
    return (
      <div className="market-tile is-empty" aria-disabled="true">
        <div className="market-tile-top">
          <b className="market-tile-title">{cat.title}</b>
          <span className={`market-tile-ic is-${cat.tone}`} aria-hidden="true">
            <Icon name={cat.icon} size={20} />
          </span>
        </div>
        <span className="market-tile-sub">در دسترس نیست</span>
      </div>
    );
  }

  return (
    <button type="button" className="market-tile" onClick={onOpen}>
      <div className="market-tile-top">
        <b className="market-tile-title">{cat.title}</b>
        <span className={`market-tile-ic is-${cat.tone}`} aria-hidden="true">
          <Icon name={cat.icon} size={20} />
        </span>
      </div>

      <div className="market-tile-body">
        <span className="market-tile-label">{info.label}</span>
        <b className="market-tile-value" dir="ltr">
          {info.value}
          {info.unit ? <small>{info.unit}</small> : null}
        </b>
      </div>

      <div className="market-tile-foot">
        <span className={`market-change is-${info.tone}`} dir="ltr">
          {info.change}
        </span>
        <span className="market-tile-count">{toFa(String(info.count))} مورد</span>
      </div>
    </button>
  );
}

/* محتوای زیرنویسِ کاشی. null یعنی داده‌ای برای این دسته نیست. */
function tileInfo(
  id: CatId,
  data: MarketSnapshot,
): {
  label: string;
  value: string;
  unit: string;
  change: string;
  tone: string;
  count: number;
} | null {
  if (id === "bourse") {
    const b = data.bourse;
    if (!b) return null;
    return {
      label: "شاخص کل",
      value: formatAmount(b.index),
      unit: "",
      change: formatSignedPercent(b.indexChangePercent),
      tone: changeTone(b.indexChange),
      count: 1,
    };
  }

  const items = itemsOf(data, id);
  if (!items.length) return null;

  const pick =
    id === "currency"
      ? (findDollar(items) ?? items[0])
      : id === "gold"
        ? featured(items, ["سکه امامی", "سکه بهار", "سکه", "طلای ۱۸"])
        : featured(items, ["بیت کوین", "بیتکوین", "تتر"]);

  if (!pick) return null;
  return {
    label: pick.name,
    value: formatAmount(pick.price),
    unit: pick.unit,
    change: formatSignedPercent(pick.changePercent),
    tone: changeTone(pick.changePercent),
    count: items.length,
  };
}

/* کارتِ فهرستِ قیمت در زیرصفحه */
function PriceListCard({
  items,
  onPick,
  heldOf,
}: {
  items: MarketItem[];
  onPick: (it: MarketItem) => void;
  /** مقدارِ ثبت‌شدهٔ این قلم، یا undefined اگر ثبت نشده */
  heldOf: (it: MarketItem) => number | undefined;
}) {
  if (!items.length) {
    return (
      <div className="empty-state">
        <span className="empty-icon" aria-hidden="true">
          <Icon name="i-alert" size={28} />
        </span>
        <p>فعلاً داده‌ای برای این بخش نیست.</p>
      </div>
    );
  }
  return (
    <section className="market-card">
      <p className="market-pick-hint">
        برای افزودن به دارایی‌هایتان روی هر ردیف بزنید.
      </p>
      <div className="market-list">
        {items.map((it) => (
          <PriceRow
            key={it.symbol}
            it={it}
            held={heldOf(it)}
            onPick={() => onPick(it)}
          />
        ))}
      </div>
    </section>
  );
}

/* سرِ کارت — آیکونِ رنگی + عنوان + شمارنده‌ی اختیاری. */
function CardHead({
  title,
  icon,
  tone,
  count,
}: {
  title: string;
  icon: string;
  tone: string;
  count?: number;
}) {
  return (
    <div className="market-card-head">
      <span className={`market-card-icon is-${tone}`} aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <h2 className="market-card-title">{title}</h2>
      {count !== undefined ? (
        <span className="market-card-count">{toFa(String(count))}</span>
      ) : null}
    </div>
  );
}

/* کارت شاخص بورس — کل، هم‌وزن و آمار بازار */
function BourseCard({ b }: { b: BourseIndex }) {
  const tone = changeTone(b.indexChange);
  return (
    <section className="market-card">
      <CardHead title="شاخص بازار" icon="i-chart" tone="rose" />

      <div className="market-bourse">
        <div className="market-bourse-head">
          <div>
            <p className="market-bourse-label">شاخص کل</p>
            <b className="market-bourse-index" dir="ltr">
              {formatAmount(b.index)}
            </b>
          </div>
          <span className={`market-change is-${tone}`} dir="ltr">
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
    </section>
  );
}

/* یک ردیف قیمت — از راست: نام | قیمت + واحد | درصدِ تغییر (بلوکِ عددی LTR است)

   ردیف خودش دکمه است، نه این‌که آیکونِ «+» جدا داشته باشد: در این اپ لمسِ
   خودِ ردیف یعنی «بازکردنِ ویرایش» و کاربر همین را انتظار دارد. اگر قلم
   قبلاً ثبت شده باشد، مقدارش روی ردیف نشان داده می‌شود و همان لمس مودال را
   در حالتِ ویرایش باز می‌کند. */
function PriceRow({
  it,
  held,
  onPick,
}: {
  it: MarketItem;
  held: number | undefined;
  onPick: () => void;
}) {
  const tone = changeTone(it.changePercent);
  return (
    <button type="button" className="market-row" onClick={onPick}>
      <span className="market-row-name">
        {it.name}
        {held !== undefined ? (
          <span className="market-row-held">{formatQuantity(held)} دارید</span>
        ) : null}
      </span>
      <span className="market-row-side">
        <span className={`market-change is-${tone}`} dir="ltr">
          {formatSignedPercent(it.changePercent)}
        </span>
        <b className="market-row-price" dir="ltr">
          {formatAmount(it.price)}
          <small>{it.unit}</small>
        </b>
      </span>
    </button>
  );
}

/* جست‌وجوی تک‌سهم — تایپ کن، سرور فیلتر می‌کند */
function StockSearchCard({
  onPick,
  heldOf,
}: {
  onPick: (s: Stock) => void;
  heldOf: (s: Stock) => number | undefined;
}) {
  const { query, setQuery, data, error, loading, clear, minChars } = useStockSearch();
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const typed = query.trim().length;
  const clock = data ? formatClock(data.fetchedAt) : "";

  return (
    <section className="market-card">
      <CardHead title="جست‌وجوی سهم" icon="i-search" tone="indigo" />

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
                  held={heldOf(s)}
                  onPick={() => onPick(s)}
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

/* ردیفِ نتیجهٔ جست‌وجو — لمسِ ردیف جزئیاتِ تابلو را باز/بسته می‌کند.

   برخلافِ PriceRow این‌جا خودِ ردیف دکمه‌ی افزودن نیست: لمسش قبلاً به
   «بازکردنِ جزئیات» اختصاص دارد و دو معنیِ متفاوت برای یک لمس، ردیف را
   غیرقابل‌پیش‌بینی می‌کند. پس افزودن یک دکمه‌ی صریح داخلِ همان جزئیات است. */
function StockRow({
  s,
  open,
  held,
  onPick,
  onToggle,
}: {
  s: Stock;
  open: boolean;
  held: number | undefined;
  onPick: () => void;
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
          {held !== undefined ? (
            <span className="market-row-held">{formatQuantity(held)} دارید</span>
          ) : null}
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

      {open ? (
        <button type="button" className="market-stock-add" onClick={onPick}>
          <Icon name="i-plus" size={16} />
          {held !== undefined ? "ویرایش مقدارِ من" : "افزودن به دارایی‌ها"}
        </button>
      ) : null}
    </div>
  );
}
