/* قواعد بازار — قالب‌بندی و جست‌وجوی خالص (بدون وابستگی به React/IO) */

import { toFa } from "@/shared/lib/digits";
import type { MarketItem } from "./market.types";

/* ارقام اعشار با حداکثر n رقم، بدون صفرِ انتهایی: 0.82 → "۰٫۸۲" ، 950 → "۹۵۰" */
function toFaDecimal(n: number, maxDigits: number): string {
  const fixed = n.toFixed(maxDigits);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
  return toFa(trimmed.replace(".", "٫"));
}

/* جهتِ تغییر: مثبت/منفی/بدون‌تغییر — رنگ را UI مشخص می‌کند */
export function changeTone(n: number): "up" | "down" | "flat" {
  if (n > 0) return "up";
  if (n < 0) return "down";
  return "flat";
}

/* تغییرِ مطلق با علامت: 6964959 → "+۶,۹۶۴,۹۵۹" ، -7000 → "−۷,۰۰۰" (dir=ltr در UI) */
export function formatSigned(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const body = Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + toFa(body);
}

/* درصدِ دقیق با علامت: 0.82 → "+۰٫۸۲٪" ، -1.18 → "−۱٫۱۸٪" */
export function formatSignedPercent(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${toFaDecimal(Math.abs(n), 2)}٪`;
}

/* ریالِ سنگین TSETMC → همت (هزار میلیارد تومان): 1.34e14 → 13.5 */
export function toHemat(rial: number): number {
  return rial / 1e13;
}

/* ISOِ سرور → ساعتِ محلیِ «HH:MM» فارسی. ورودیِ نامعتبر → "" تا UI
   به‌جای «NaN:NaN» چیزی نشان ندهد. برایِ اعلامِ «قیمت مالِ چه لحظه‌ای است». */
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

/* دلارِ فهرستِ ارز — «دلار آمریکا» (یا اولین نامِ شاملِ «دلار») */
export function findDollar(items: MarketItem[]): MarketItem | null {
  return (
    items.find((i) => i.name.replace(/\s/g, "") === "دلارآمریکا") ??
    items.find((i) => i.name.includes("دلار")) ??
    null
  );
}

/* ── یکسان‌سازیِ واحدِ قیمت به تومان ───────────────────────────

   چرا این‌جا لازم است؟ اسنپ‌شاتِ بازار واحدِ *خام*ِ بالادست را می‌دهد
   (رمزارز اغلب «دلار»، سهم «ریال»، طلا/ارز «تومان»)، ولی ارزشِ دارایی که
   سرور برمی‌گرداند همیشه تومان است. اگر پیش‌نمایشِ «ارزشِ امروز» را از
   قیمتِ خام می‌ساختیم، کاربر در مودال یک عدد می‌دید و یک لحظه بعد در
   «دارایی‌ها» عددِ دیگری — برایِ سهم دقیقاً ۱۰ برابر.

   این‌ها عمداً آینهٔ _FIAT_TOMAN/_to_toman در backend/app/services/market.py
   هستند. هر تغییری آن‌جا باید این‌جا هم بیاید، وگرنه همان اختلاف برمی‌گردد. */

const FIAT_TOMAN: Record<string, number> = { تومان: 1, ریال: 0.1 };

/* حرف‌های هم‌شکلِ عربی → فارسی + حذفِ فاصله/نیم‌فاصله + حروفِ کوچک.
   بدونِ این، «ريال» با یایِ عربی ناشناخته می‌ماند و قیمت حذف می‌شد. */
function normUnit(s: string): string {
  return (s || "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ـ‌\s]/g, "")
    .toLowerCase();
}

/** نرخِ دلار به تومان از همان فهرستِ ارز — ۰ یعنی پیدا نشد.
    عمداً بازگشتی حل نمی‌شود: واحدِ خودِ دلار فقط ریال/تومان است. */
export function usdToman(currency: MarketItem[]): number {
  const row = findDollar(currency);
  if (!row || row.price <= 0) return 0;
  const n = normUnit(row.unit);
  if (!n) return row.price;
  return row.price * (FIAT_TOMAN[n] ?? 0);
}

/** قیمتِ یک قلم → تومان. خروجیِ ۰ یعنی «واحد را نمی‌شناسیم» و UI باید
    به‌جای عددِ غلط، هیچ عددی نشان ندهد (همان رفتارِ priced=false سرور).
    واحدِ خالی عمداً تومان فرض می‌شود: واحدِ پیش‌فرضِ بالادست همان است. */
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
