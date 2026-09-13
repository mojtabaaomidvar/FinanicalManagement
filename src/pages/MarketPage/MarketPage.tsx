/* صفحه بازار — شبکه‌ی چهار کاشی (بورس، طلا، ارز، رمزارز) + زیرصفحه‌ی هر دسته.

   چیدمان: صفحه‌ی اصلی فقط چهار کاشی است؛ لمس هر کاشی زیرصفحه‌ی کامل همان
   دسته را باز می‌کند. پیش‌تر همه‌ی فهرست‌ها پشت سر هم در یک اسکرول بودند و
   رسیدن به «رمزارز» یعنی رد کردن ۲۰ ردیف ارز؛ حالا هر دسته یک لمس فاصله دارد.

   زیرنویس کاشی عمداً «تعداد» نیست بلکه شاخص همان دسته است (دلار، سکه،
   بیت‌کوین، شاخص کل) — «۲۳ مورد» چیزی به کاربر نمی‌گوید، ولی قیمت دلار
   اغلب همان چیزی است که کاربر برایش آمده و بدون هیچ لمسی دیده می‌شود.

   بازگشت: زیرصفحه با useBackGuard به دکمه‌ی فیزیکی/سوایپ اندروید وصل است،
   پس بازگشت از زیرصفحه به شبکه می‌رسد نه بیرون صفحه‌ی بازار.

   داده با هوک مشترک features/market می‌آید (همان که زیرنویس کاشی هاب را
   می‌سازد)؛ refresh کش کلاینت را دور می‌زند، سرور تا ۵ دقیقه کش می‌کند. */

import type { CSSProperties } from "react";
import { useState } from "react";
import { BrandMark, Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { useApp } from "@/app/providers/AppProvider";
import { useMarket, useStockSearch } from "@/features/market";
import { AddHoldingModal, useHoldings } from "@/features/holdings";
import type { HoldingTarget } from "@/features/holdings";
import { findHolding, formatQuantity } from "@/domain/holding/holding.rules";
import type { HoldingKind } from "@/domain/holding/holding.types";
import {
  changeTone,
  cryptoUsd,
  findDollar,
  formatClock,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  formatUsd,
  shownPrice,
  tetherToman,
  toHemat,
  usdToman,
  visibleCurrency,
} from "@/domain/market/market.rules";
import { brandOf, tintOf } from "@/domain/market/market.brand";
import type {
  BourseIndex,
  MarketItem,
  MarketSnapshot,
  Stock,
} from "@/domain/market/market.types";
import { MarketSubPage } from "./MarketSubPage";

/** شناسه‌ی دسته — همان کلیدی که زیرصفحه را انتخاب می‌کند */
type CatId = "bourse" | "gold" | "currency" | "crypto";

/* دستهٔ صفحه → نوع دارایی. فقط «بورس» نامش فرق دارد؛ بقیه یکی‌اند ولی
   نگاشت صریح نوشته شده تا اگر روزی دسته‌ای اضافه شد، TypeScript همین‌جا
   خطا بدهد نه در زمان اجرا. */
const HOLDING_KIND: Record<CatId, HoldingKind> = {
  bourse: "stock",
  gold: "gold",
  currency: "currency",
  crypto: "crypto",
};

/* نرخ‌های پل تبدیل، با هم.

   چرا یک شیء و نه دو آرگومان عدد؟ این نرخ‌ها از بالا تا کاشی از پنج
   کامپوننت رد می‌شوند و دو عدد هم‌جنس کنار هم دیر یا زود جابه‌جا نوشته
   می‌شوند — تایپ‌چک هم چیزی نمی‌گوید چون هر دو number‌اند. اسم فیلد این
   خطا را غیرممکن می‌کند. */
type Rates = {
  /** دلار آزاد به تومان — برای تومانی‌کردن ردیف‌های دلاری بالادست */
  usd: number;
  /** تتر به تومان — پل برگرداندن قیمت رمزارز به دلار */
  tether: number;
};

/* ردیف بازار → هدف افزودن.

   قیمت دو پله تبدیل می‌شود: اول واحد خام بالادست (رمزارز اغلب دلار، سهم
   ریال، طلا/ارز تومان) به تومان یکسان می‌شود، بعد واحد پول خود کاربر
   اعمال می‌شود. پلهٔ اول لازم است چون سرور ارزش دارایی را همیشه تومانی
   برمی‌گرداند و بدونش پیش‌نمایش مودال با عدد «دارایی‌ها» فرق می‌کرد —
   برای سهم دقیقاً ۱۰ برابر. پلهٔ دوم لازم است چون مودال و کاشی باید یک
   واحد را نشان دهند؛ اگر کاشی ریال بگوید و مودال تومان، کاربر فکر می‌کند
   قیمت عوض شده.

   `unit` این‌جا برچسب *نمایشی* است، نه واحد ذخیره‌سازی؛ آن یکی `storeUnit`
   است و همیشه «تومان» می‌ماند چون سرور با همین واحد ارزش‌گذاری می‌کند. */
function itemTarget(
  kind: HoldingKind,
  it: MarketItem,
  rates: Rates,
  cur: string,
): HoldingTarget {
  const shown = shownPrice(it.price, it.unit, rates.usd, cur);
  return {
    kind,
    symbol: it.symbol,
    name: it.name,
    unit: shown.unit,
    price: shown.price,
    storeUnit: "تومان",
  };
}

function stockTarget(s: Stock, cur: string): HoldingTarget {
  // تابلوی بورس همیشه ریال است؛ نرخ دلار در این مسیر بی‌ربط است.
  const shown = shownPrice(s.price, "ریال", 0, cur);
  return {
    kind: "stock",
    symbol: s.symbol,
    name: s.name,
    unit: shown.unit,
    price: shown.price,
    storeUnit: "تومان",
  };
}

type Cat = {
  id: CatId;
  title: string;
  icon: string;
  tone: string;
};

/* یک منبع واحد برای عنوان/آیکون/رنگ — کاشی و زیرصفحه هر دو از این می‌خوانند
   تا عنوان کاشی و عنوان زیرصفحه هیچ‌وقت از هم جدا نیفتند. */
const CATS: Cat[] = [
  { id: "bourse", title: "بورس تهران", icon: "i-chart", tone: "rose" },
  { id: "gold", title: "طلا و سکه", icon: "i-crown", tone: "amber" },
  { id: "currency", title: "ارز", icon: "i-swap", tone: "sky" },
  // آیکون رمزارز در اسپرایت نیست؛ i-grid4 خنثی‌ترین گزینه است.
  { id: "crypto", title: "رمزارز", icon: "i-grid4", tone: "violet" },
];

/* ZWNJ (نیم‌فاصله) را برمی‌دارد تا «بیت‌کوین» و «بیت کوین» یکی شمرده شوند.
   بالادست هر دو املا را دیده‌ایم، پس تطبیق خام شکننده است. */
function norm(s: string): string {
  return s.replace(/‌/g, "").replace(/\s+/g, "");
}

/** مورد شاخص یک دسته برای زیرنویس کاشی؛ اگر پیدا نشد، اولین مورد. */
function featured(items: MarketItem[], names: string[]): MarketItem | null {
  if (!items.length) return null;
  for (const want of names) {
    const hit = items.find((it) => norm(it.name).includes(norm(want)));
    if (hit) return hit;
  }
  return items[0];
}

/** آیتم‌های *نمایشی* یک دسته از اسنپ‌شات.

    فهرست ارز از ردیف تتر پاک می‌شود. این تنها جایی است که کاشی‌ها و
    زیرصفحه از آن می‌خوانند، پس فیلتر همین‌جا کافی است — ولی محاسبهٔ نرخ‌ها
    عمداً از `data.currency` خام می‌خواند، وگرنه با حذف ردیف، پل تبدیل
    دلاری رمزارز هم از دست می‌رفت. */
function itemsOf(data: MarketSnapshot, id: CatId): MarketItem[] {
  if (id === "gold") return data.gold;
  if (id === "currency") return visibleCurrency(data.currency);
  if (id === "crypto") return data.crypto;
  return [];
}

export function MarketPage() {
  const { cur } = useApp();
  const { data, error, loading, refresh } = useMarket();
  const holdings = useHoldings();
  const [open, setOpen] = useState<CatId | null>(null);
  const [target, setTarget] = useState<HoldingTarget | null>(null);

  // بازگشت اندروید باید زیرصفحه را ببندد، نه از صفحه‌ی بازار بیرون بزند.
  useBackGuard(open !== null, () => setOpen(null));

  /* نرخ‌های پل از همان اسنپ‌شات — هر دو از فهرست *خام* ارز خوانده می‌شوند.

     دلار: تنها راه تومانی‌کردن ردیف‌هایی که بالادست دلاری قیمت زده (اغلب
     رمزارز). نبودش یعنی آن ردیف‌ها بی‌قیمت نشان داده می‌شوند، نه با عدد غلط.

     تتر: پل برگرداندن قیمت رمزارز به دلار. ردیفش از فهرست نمایشی حذف
     شده ولی داده‌اش سر جایش است — به همین دلیل این‌جا `data.currency` است
     و نه `itemsOf(data, "currency")`. */
  const rates: Rates = data
    ? { usd: usdToman(data.currency), tether: tetherToman(data.currency) }
    : { usd: 0, tether: 0 };

  /* ردیف ثبت‌شدهٔ همین قلم (اگر باشد) — همان چیزی که مودال را از حالت
     «افزودن» به «ویرایش» می‌برد. */
  const existing = target
    ? findHolding(holdings.items, target.kind, target.symbol, target.name)
    : undefined;

  const pick = (t: HoldingTarget) => {
    /* خطای مانده از تلاش قبلی نباید بالای فرم تازه ظاهر شود. */
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
          unit: target.storeUnit,
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

  /** آیا این قلم قبلاً در دارایی‌ها هست؟ — برای نشان «دارید» روی ردیف */
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
     گارد از حالت لبه‌ای «باز بود و داده پاک شد» هم محافظت می‌کند. */
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
                cur={cur}
                onPick={(s) => pick(stockTarget(s, cur))}
                heldOf={(s) => heldQuantity("stock", s.symbol, s.name)}
              />
            </>
          ) : (
            <PriceGridCard
              kind={kind}
              items={itemsOf(data, open)}
              rates={rates}
              cur={cur}
              onPick={(it) => pick(itemTarget(kind, it, rates, cur))}
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
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void refresh()}
              >
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
                  rates={rates}
                  cur={cur}
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

/* کاشی یک دسته — عنوان + آیکون رنگی + زیرنویس زنده.
   کاشی بی‌داده غیرفعال می‌شود تا لمسش زیرصفحه‌ی خالی باز نکند. */
function CatTile({
  cat,
  data,
  rates,
  cur,
  onOpen,
}: {
  cat: Cat;
  data: MarketSnapshot;
  /** نرخ‌های پل برای یکسان‌سازی قیمت رمزارز */
  rates: Rates;
  /** واحد پول کاربر — زیرنویس کاشی باید با زیرصفحه یکی باشد */
  cur: string;
  onOpen: () => void;
}) {
  const info = tileInfo(cat.id, data, rates, cur);

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
        <span className="market-tile-count">
          {toFa(String(info.count))} مورد
        </span>
      </div>
    </button>
  );
}

/* محتوای زیرنویس کاشی. null یعنی داده‌ای برای این دسته نیست. */
function tileInfo(
  id: CatId,
  data: MarketSnapshot,
  rates: Rates,
  cur: string,
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
      /* شاخص کل عدد است نه مبلغ — واحد پول ندارد و نباید ضرب شود.
         به همین دلیل هم unit خالی است. */
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
  /* همان تبدیل دو‌پله‌ای کاشی زیرصفحه: بدون این، کاشی هاب «تومان» می‌ماند
     و کاربر با یک لمس عدد ده‌برابری می‌بیند — همان ناهماهنگی گزارش‌شده. */
  const shown = shownPrice(pick.price, pick.unit, rates.usd, cur);
  return {
    label: pick.name,
    value: shown.price > 0 ? formatAmount(shown.price) : "بی‌قیمت",
    unit: shown.price > 0 ? shown.unit : "",
    change: formatSignedPercent(pick.changePercent),
    tone: changeTone(pick.changePercent),
    count: items.length,
  };
}

/* شبکهٔ کاشی قیمت در زیرصفحه — دو ستون، هر قلم با نشان و رنگ خودش.

   چرا کاشی و نه فهرست ردیفی؟ ردیف‌ها همه یک شکل بودند و پیدا کردن
   «تتر» بین سی ردیف هم‌شکل یعنی خواندن نام‌ها یکی‌یکی. با نشان رنگی
   هر قلم، چشم پیش از خواندن تشخیص می‌دهد. */
function PriceGridCard({
  kind,
  items,
  rates,
  cur,
  onPick,
  heldOf,
}: {
  kind: HoldingKind;
  items: MarketItem[];
  /** نرخ‌های پل — برای قلم‌هایی که بالادست دلاری قیمت زده و برای خط دلاری */
  rates: Rates;
  /** واحد پول کاربر */
  cur: string;
  onPick: (it: MarketItem) => void;
  /** مقدار ثبت‌شدهٔ این قلم، یا undefined اگر ثبت نشده */
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
        برای افزودن به دارایی‌هایتان روی هر کاشی بزنید.
      </p>
      <div className="pt-grid">
        {items.map((it) => (
          <PriceTile
            /* symbol برای طلا و ارز ممکن است خالی باشد (بالادست همیشه
               نمی‌فرستد) و آن‌وقت همه‌ی کاشی‌ها یک کلید می‌گرفتند. همان
               قاعده‌ی price_key در بک‌اند: هویت = symbol وگرنه name. */
            key={it.symbol || it.name}
            kind={kind}
            it={it}
            rates={rates}
            cur={cur}
            held={heldOf(it)}
            onPick={() => onPick(it)}
          />
        ))}
      </div>
    </section>
  );
}

/* سر کارت — آیکون رنگی + عنوان + شمارنده‌ی اختیاری. */
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

/* کارت شاخص بورس — کل، هم‌وزن و آمار بازار.

   عمداً واحد پول کاربر را نمی‌گیرد: «شاخص» عدد است نه مبلغ، و «همت»
   (هزار میلیارد تومان) خودش واحد مستقلی است که ضرب در ۱۰ آن را به
   عددی بی‌نام تبدیل می‌کند. پس این کارت در هر دو حالت یکسان است. */
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
            {formatSigned(b.indexChange)} (
            {formatSignedPercent(b.indexChangePercent)})
          </span>
        </div>

        <div className="market-bourse-grid">
          <div>
            <span>شاخص هم‌وزن</span>
            <b dir="ltr">{formatAmount(b.indexEqualWeight)}</b>
            <small
              className={`market-change is-${changeTone(b.indexEqualWeightChange)}`}
              dir="ltr"
            >
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

/* یک کاشی قیمت — نشان برند + نام + قیمت + درصد تغییر.

   رنگ برند به‌صورت متغیر CSS (--brand) تزریق می‌شود نه کلاس ثابت: برای
   ~۹۰ قلم این فهرست نمی‌شود ۹۰ کلاس نوشت، و پس‌زمینهٔ ملایم در CSS با
   color-mix از همین یک متغیر ساخته می‌شود.

   کل کاشی دکمه است، مثل ردیف قبلی: در این اپ لمس خود قلم یعنی
   «افزودن/ویرایش مقدار». */
function PriceTile({
  kind,
  it,
  rates,
  cur,
  held,
  onPick,
}: {
  kind: HoldingKind;
  it: MarketItem;
  rates: Rates;
  cur: string;
  held: number | undefined;
  onPick: () => void;
}) {
  const tone = changeTone(it.changePercent);
  const brand = brandOf(kind, it.symbol, it.name);
  const shown = shownPrice(it.price, it.unit, rates.usd, cur);
  /* خط دلاری فقط برای رمزارز: قیمت جهانی بیت‌کوین عددی است که کاربر
     می‌شناسد و با آن مقایسه می‌کند. برای طلا و ارز بی‌معنی است — کسی
     «سکهٔ امامی» را دلاری نمی‌سنجد — و فقط کاشی را شلوغ می‌کرد. */
  const usd =
    kind === "crypto"
      ? cryptoUsd(it.price, it.unit, rates.tether, rates.usd)
      : 0;
  return (
    <button
      type="button"
      className={`pt-tile${held !== undefined ? " is-held" : ""}`}
      style={{ "--brand": tintOf(brand) } as CSSProperties}
      onClick={onPick}
    >
      <span className="pt-top">
        <BrandMark brand={brand} size={38} />
        <span className={`market-change is-${tone}`} dir="ltr">
          {formatSignedPercent(it.changePercent)}
        </span>
      </span>

      <span className="pt-name">{it.name}</span>

      {/* قیمت ۰ یعنی واحد بالادست ناشناخته بود؛ «۰ تومان» عدد غلطی است
          که کاربر باورش می‌کند، پس مثل مودال صریح می‌گوییم نداریم. */}
      {shown.price > 0 ? (
        <span className="pt-price" dir="ltr">
          {formatAmount(shown.price)}
          <small>{shown.unit}</small>
        </span>
      ) : (
        <span className="pt-price is-muted">بی‌قیمت</span>
      )}

      {/* قیمت دلاری — زیر قیمت تومانی و ریزتر، چون عدد اصلی کاربر همان
          تومان/ریال تنظیماتش است و این یکی مرجع مقایسه با بازار جهانی. */}
      {usd > 0 ? (
        <span className="pt-usd" dir="ltr">
          {formatUsd(usd)}
          <small>دلار</small>
        </span>
      ) : null}

      {held !== undefined ? (
        <span className="pt-held">{formatQuantity(held)} دارید</span>
      ) : null}
    </button>
  );
}

/* جست‌وجوی تک‌سهم — تایپ کن، سرور فیلتر می‌کند */
function StockSearchCard({
  cur,
  onPick,
  heldOf,
}: {
  /** واحد پول کاربر — تابلوی بورس ریال است و به این واحد تبدیل می‌شود */
  cur: string;
  onPick: (s: Stock) => void;
  heldOf: (s: Stock) => number | undefined;
}) {
  const { query, setQuery, data, error, loading, clear, minChars } =
    useStockSearch();
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
          placeholder="نماد یا نام شرکت — مثل فولاد"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenSymbol(null);
          }}
          aria-label="جست‌وجوی نماد بورس"
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

      {/* حالت‌ها عمداً همه پوشش داده شده‌اند تا کاربر هرگز جعبه‌ی خالی بی‌توضیح نبیند */}
      {typed > 0 && typed < minChars ? (
        <p className="market-search-hint">
          برای جست‌وجو دست‌کم {toFa(String(minChars))} حرف بنویسید.
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
              {clock ? `قیمت‌ها در ساعت ${clock}` : "قیمت‌های آخرین دریافت"}
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
                  cur={cur}
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

/* ردیف نتیجهٔ جست‌وجو — لمس ردیف جزئیات تابلو را باز/بسته می‌کند.

   برخلاف PriceRow این‌جا خود ردیف دکمه‌ی افزودن نیست: لمسش قبلاً به
   «بازکردن جزئیات» اختصاص دارد و دو معنی متفاوت برای یک لمس، ردیف را
   غیرقابل‌پیش‌بینی می‌کند. پس افزودن یک دکمه‌ی صریح داخل همان جزئیات است. */
function StockRow({
  s,
  cur,
  open,
  held,
  onPick,
  onToggle,
}: {
  s: Stock;
  cur: string;
  open: boolean;
  held: number | undefined;
  onPick: () => void;
  onToggle: () => void;
}) {
  const tone = changeTone(s.changePercent);
  /* تابلوی TSETMC همیشه ریال است. یک تابع محلی می‌سازیم چون این ردیف پنج
     عدد قیمتی دارد (آخرین، پایانی، دیروز، کم‌ترین، بیش‌ترین) و تکرار
     shownPrice پنج بار با آرگومان‌های یکسان، فرصت جاافتادن یکی است.
     `unit` یک‌بار از همان تابع گرفته می‌شود تا برچسب و عدد جدا نیفتند.

     «ارزش معاملات» عمداً از این مسیر بیرون است: «همت» خودش واحد مستقلی است
     (هزار میلیارد تومان) و ضربش در ۱۰ عددی می‌سازد که اسمش دیگر همت نیست. */
  const board = (rial: number) => shownPrice(rial, "ریال", 0, cur);
  const last = board(s.price);
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
            <span className="market-row-held">
              {formatQuantity(held)} دارید
            </span>
          ) : null}
          <span className={`market-change is-${tone}`} dir="ltr">
            {formatSignedPercent(s.changePercent)}
          </span>
          <b className="market-row-price" dir="ltr">
            {formatAmount(last.price)}
            <small>{last.unit}</small>
          </b>
        </span>
      </button>

      {open ? (
        <div className="market-stock-detail">
          <div>
            <span>قیمت پایانی</span>
            <b dir="ltr">{formatAmount(board(s.closePrice).price)}</b>
            <small
              className={`market-change is-${changeTone(s.closeChangePercent)}`}
              dir="ltr"
            >
              {formatSignedPercent(s.closeChangePercent)}
            </small>
          </div>
          <div>
            <span>دیروز</span>
            <b dir="ltr">{formatAmount(board(s.yesterday).price)}</b>
          </div>
          <div>
            <span>کم‌ترین روز</span>
            <b dir="ltr">{formatAmount(board(s.low).price)}</b>
          </div>
          <div>
            <span>بیش‌ترین روز</span>
            <b dir="ltr">{formatAmount(board(s.high).price)}</b>
          </div>
          <div>
            <span>حجم معاملات</span>
            <b>{formatCompact(s.volume)} سهم</b>
          </div>
          <div>
            <span>ارزش معاملات</span>
            <b dir="ltr">{formatAmount(toHemat(s.value))} همت</b>
          </div>
          <div>
            <span>تعداد معاملات</span>
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
          {held !== undefined ? "ویرایش مقدار من" : "افزودن به دارایی‌ها"}
        </button>
      ) : null}
    </div>
  );
}
