/* قواعد بازار — قالب‌بندی و جست‌وجوی خالص (بدون وابستگی به React/IO) */

import { toFa } from "@/shared/lib/digits";
import { currencyFactor } from "@/shared/lib/currency";
import type { MarketItem } from "./market.types";

/* ارقام اعشار با حداکثر n رقم، بدون صفر انتهایی: 0.82 → "۰٫۸۲" ، 950 → "۹۵۰" */
function toFaDecimal(n: number, maxDigits: number): string {
  const fixed = n.toFixed(maxDigits);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
  return toFa(trimmed.replace(".", "٫"));
}

/* جهت تغییر: مثبت/منفی/بدون‌تغییر — رنگ را UI مشخص می‌کند */
export function changeTone(n: number): "up" | "down" | "flat" {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/* تغییر مطلق با علامت: 6964959 → "+۶,۹۶۴,۹۵۹" ، -7000 → "−۷,۰۰۰" (dir=ltr در UI) */
export function formatSigned(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const body = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + toFa(body);
}

/* درصد دقیق با علامت: 0.82 → "+۰٫۸۲٪" ، -1.18 → "−۱٫۱۸٪" */
export function formatSignedPercent(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${toFaDecimal(Math.abs(n), 2)}٪`;
}

/* ریال سنگین TSETMC → همت (هزار میلیارد تومان): 1.34e14 → 13.5 */
export function toHemat(rial: number): number {
  return rial / 1e13;
}

/* ISO سرور → ساعت محلی «HH:MM» فارسی. ورودی نامعتبر → "" تا UI
   به‌جای «NaN:NaN» چیزی نشان ندهد. برای اعلام «قیمت مال چه لحظه‌ای است». */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return toFa(`${hh}:${mm}`);
}

/* حجم/تعداد بزرگ → خوانا: 16326463426 → "۱۶٫۳ میلیارد" */
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${toFaDecimal(n / 1e9, 1)} میلیارد`;
  if (abs >= 1e6) return `${toFaDecimal(n / 1e6, 1)} میلیون`;
  if (abs >= 1e3) return `${toFaDecimal(n / 1e3, 1)} هزار`;
  return toFaDecimal(n, 0);
}

/* نام نرمال‌شده برای مقایسه — همان قاعدهٔ `_norm_search` بک‌اند */
function normName(s: string): string {
  return (s || "")
    .replace(/[يﻱﻲ]/g, "ی")
    .replace(/[كﻙﻚ]/g, "ک")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/[\s‌ـ]/g, "");
}

/** ردیف «دلار تتر» است؟

    بالادست تتر را داخل فهرست *ارز* هم می‌گذارد (نرخ تتر بازار ایران به
    تومان) و هم داخل رمزارز (قیمت جهانی‌اش، که همیشه ~۱ دلار است). این دو
    یک چیز نیستند و نباید قاطی شوند. */
export function isTetherRow(it: MarketItem): boolean {
  return normName(it.name).includes("تتر");
}

/* دلار فهرست ارز — «دلار آمریکا» (یا اولین نام شامل «دلار»).

   ردیف تتر عمداً کنار گذاشته می‌شود: نامش هم «دلار» دارد و اگر بالادست
   روزی «دلار آمریکا» را نفرستد، شرط دوم این تابع تتر ~۱۱۰ هزار تومانی را
   به‌جای نرخ دلار برمی‌داشت و *همهٔ* قیمت‌های دلاری اپ کج می‌شد. */
export function findDollar(items: MarketItem[]): MarketItem | null {
  const real = items.filter((i) => !isTetherRow(i));
  return (
    real.find((i) => normName(i.name) === "دلارامریکا") ??
    real.find((i) => i.name.includes("دلار")) ??
    null
  );
}

/** فهرست ارز *نمایشی* — بدون ردیف تتر.

    چرا حذف و نه نگه‌داشتن؟ «دلار تتر» ارز کشوری نیست، نرخ یک رمزارز است؛
    کنار دلار و یورو نشستنش کاربر را به اشتباه می‌اندازد (خواستهٔ کاربر،
    ۲۰۲۶-۰۹-۱۳). ولی از *داده* حذف نمی‌شود: همان ردیف پل تبدیل قیمت
    رمزارز به دلار است، پس محاسبه‌ها باید از فهرست خام بخوانند نه از این. */
export function visibleCurrency(items: MarketItem[]): MarketItem[] {
  return items.filter((i) => !isTetherRow(i));
}

/* ── یکسان‌سازی واحد قیمت به تومان ───────────────────────────

   چرا این‌جا لازم است؟ اسنپ‌شات بازار واحد *خام* بالادست را می‌دهد
   (رمزارز اغلب «دلار»، سهم «ریال»، طلا/ارز «تومان»)، ولی ارزش دارایی که
   سرور برمی‌گرداند همیشه تومان است. اگر پیش‌نمایش «ارزش امروز» را از
   قیمت خام می‌ساختیم، کاربر در مودال یک عدد می‌دید و یک لحظه بعد در
   «دارایی‌ها» عدد دیگری — برای سهم دقیقاً ۱۰ برابر.

   این‌ها عمداً آینهٔ _FIAT_TOMAN/_to_toman در backend/app/services/market.py
   هستند. هر تغییری آن‌جا باید این‌جا هم بیاید، وگرنه همان اختلاف برمی‌گردد. */

const FIAT_TOMAN: Record<string, number> = { تومان: 1, ریال: 0.1 };

/* حرف‌های هم‌شکل عربی → فارسی + حذف فاصله/نیم‌فاصله + حروف کوچک.
   بدون این، «ريال» با یای عربی ناشناخته می‌ماند و قیمت حذف می‌شد. */
function normUnit(s: string): string {
  return (s || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ـ‌\s]/g, "")
    .toLowerCase();
}

/** نرخ دلار به تومان از همان فهرست ارز — ۰ یعنی پیدا نشد.
    عمداً بازگشتی حل نمی‌شود: واحد خود دلار فقط ریال/تومان است. */
export function usdToman(currency: MarketItem[]): number {
  const row = findDollar(currency);
  if (!row || row.price <= 0) return 0;
  const n = normUnit(row.unit);
  if (!n) return row.price;
  return row.price * (FIAT_TOMAN[n] ?? 0);
}

/** قیمت یک قلم → تومان. خروجی ۰ یعنی «واحد را نمی‌شناسیم» و UI باید
    به‌جای عدد غلط، هیچ عددی نشان ندهد (همان رفتار priced=false سرور).
    واحد خالی عمداً تومان فرض می‌شود: واحد پیش‌فرض بالادست همان است. */
export function toToman(price: number, unit: string, usdRate: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const n = normUnit(unit);
  if (!n) return price;
  if (n in FIAT_TOMAN) return price * FIAT_TOMAN[n];
  if (n.includes("دلار") || n === "usd" || n === "$") {
    return usdRate > 0 ? price * usdRate : 0;
  }
  return 0;
}

/* ── قیمت آمادهٔ نمایش ────────────────────────────────────────

   چرا یک تابع جدا و نه صداکردن toDisplay در هر جای UI؟ چون قیمت بازار
   دو پله دارد: اول واحد *خام بالادست* (دلار/ریال/تومان) باید به تومان
   یکسان شود، بعد واحد *دلخواه کاربر* اعمال شود. جدا نوشتن این دو پله در
   پنج نقطهٔ صفحه یعنی پنج فرصت برای جاافتادن یکی از آن‌ها — و جاافتادن
   پلهٔ دوم همان باگی بود که کاربر دید: تنظیمات «ریال» ولی کاشی «تومان».

   خروجی هم عدد و هم برچسب می‌دهد تا نمایش‌دهنده نتواند عدد تبدیل‌شده را
   با برچسب اشتباه جفت کند. price=0 یعنی «قیمت نداریم» و UI باید متن
   «در دسترس نیست» بگذارد، نه صفر. */
export type ShownPrice = { price: number; unit: string };

/** قیمت خام بالادست → عدد و برچسب واحد در واحد پول کاربر */
export function shownPrice(
  rawPrice: number,
  rawUnit: string,
  usdRate: number,
  currency: string | null | undefined,
): ShownPrice {
  const toman = toToman(rawPrice, rawUnit, usdRate);
  const unit = currency === "ریال" ? "ریال" : "تومان";
  // ۰ را از تبدیل رد نمی‌کنیم تا «۰ ریال» ساخته نشود؛ ۰ یعنی بی‌قیمت.
  if (toman <= 0) return { price: 0, unit };
  return { price: toman * currencyFactor(currency), unit };
}

/* ── قیمت دلاری رمزارز ───────────────────────────────────────

   خواستهٔ کاربر (۲۰۲۶-۰۹-۱۳): کنار قیمت تومانی/ریالی، قیمت دلاری هم
   دیده شود و «تبدیل به دلار با تتر انجام شود».

   چرا تتر و نه نرخ دلار آزاد؟ چون بازار رمزارز ایران با تتر معامله
   می‌کند، نه با اسکناس. قیمت تومانی بیت‌کوین که بالادست می‌دهد از همان
   نرخ تتر ساخته شده؛ اگر برای برگرداندنش به دلار نرخ دلار آزاد را
   بگذاریم، اختلاف چنددرصدی تتر و اسکناس در عدد می‌نشیند و کاربر یک
   بیت‌کوین مثلاً ۹۷ هزار دلاری می‌بیند که هیچ صرافی‌ای آن را نشان نمی‌دهد.
   تقسیم بر همان نرخی که ضرب شده، عدد جهانی را سالم برمی‌گرداند. */

/** نرخ تتر به تومان از فهرست *خام* ارز — ۰ یعنی پیدا نشد.

    ورودی باید فهرست فیلترنشده باشد: `visibleCurrency` ردیف تتر را از
    نمایش برمی‌دارد ولی این تابع دقیقاً به همان ردیف نیاز دارد. */
export function tetherToman(currency: MarketItem[]): number {
  const row = currency.find(isTetherRow);
  if (!row || row.price <= 0) return 0;
  const n = normUnit(row.unit);
  if (!n) return row.price;
  return row.price * (FIAT_TOMAN[n] ?? 0);
}

/** قیمت یک رمزارز به دلار. ۰ یعنی نمی‌شود حساب کرد و UI نباید چیزی نشان دهد.

    دو مسیر دارد چون بالادست ثابت نیست: بعضی ردیف‌ها واحدشان خود «دلار»
    است (که آن‌وقت هر تبدیلی فقط خطا اضافه می‌کند) و بعضی تومان. */
export function cryptoUsd(
  rawPrice: number,
  rawUnit: string,
  tetherRate: number,
  usdRate: number,
): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  const n = normUnit(rawUnit);
  if (n.includes("دلار") || n === "usd" || n === "$") return rawPrice;

  /* نرخ پل: تتر اولویت دارد، دلار آزاد فقط وقتی تتر نیامده باشد — عدد
     تقریبی از هیچ‌چیز بهتر است، ولی برعکسش نه. */
  const bridge = tetherRate > 0 ? tetherRate : usdRate;
  if (bridge <= 0) return 0;

  const toman = toToman(rawPrice, rawUnit, usdRate);
  if (toman <= 0) return 0;
  return toman / bridge;
}

/** عدد دلاری برای نمایش — دقت اعشار به بزرگی عدد بستگی دارد.

    چرا `formatAmount` به‌کار نمی‌آید؟ آن گرد می‌کند، و شیبا و پپه قیمتشان
    هزارم سنت است: همه‌شان «۰» می‌شدند. از آن طرف نوشتن بیت‌کوین با شش رقم
    اعشار هم در کاشی ۱۶۰ پیکسلی جا نمی‌شود. */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1000) {
    return toFa(Math.round(n).toLocaleString("en-US"));
  }
  if (n >= 1) return toFaDecimal(n, 2);
  if (n >= 0.01) return toFaDecimal(n, 4);
  return toFaDecimal(n, 8);
}
