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
