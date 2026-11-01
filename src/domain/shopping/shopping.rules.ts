/* §۱.۸ — قواعدِ خالصِ خرید و انبار.

   این‌جا هیچ fetch و هیچ JSX نیست: همان دلیلِ `calendar.rules.ts` — منطقی
   که در JSX بنویسی آزمون‌پذیر نیست و خرابی‌اش بی‌صدا است. مثلِ «کم‌بودِ
   انبار» که اگر غلط باشد، اعلانِ §۷ هم غلط می‌شود بی‌آنکه چیزی خطا بدهد. */

import type { InventoryItem, ShoppingItem, ShoppingList } from "./shopping.types";
import { normalizeNumeric, toFa } from "@/shared/lib/digits";

/** دو رقمِ اعشار — هم‌سان با ستون‌های `Numeric(10, 2)`ِ خرید و انبار. */
export const QTY_DECIMALS = 2;

/** ورودیِ کاربر («۱٫۵» یا «1.5») → عدد. خالی/نامعتبر/منفی → ۰.
 *
 *  پاک‌سازیِ رشته از `normalizeNumeric` می‌آید، نه دست‌نوشته. سه باگی که
 *  نسخهٔ دست‌نوشتهٔ اول داشت و با اجرا پیدا شد:
 *  • `٫` (U+066B) را نمی‌شناخت، پس «۱٫۵» را **۱۵** می‌خواند — و چون
 *    `liveFormatQty` خودش همان `٫` را می‌نویسد، ویرایشِ قلمی با تعدادِ ۱٫۵
 *    آن را ۱۵ ذخیره می‌کرد.
 *  • علامتِ منفی را *پس از* پاک‌سازی چک می‌کرد، پس «−۵» بی‌صدا ۵ می‌شد.
 *  • جداکنندهٔ هزار را اعشار می‌گرفت.
 *
 *  جفتِ **شش**-رقمیِ همین توابع در `domain/holding/holding.rules.ts` است؛
 *  آن‌جا ستون `Numeric(18, 6)` است و این‌جا `Numeric(10, 2)`، پس گردکردن و
 *  قالبِ زنده فرق دارند — ولی *پاک‌سازی* حالا مشترک است. */
export function parseQty(raw: string): number {
  const text = String(raw).trim();
  /* منفی باید **پیش از** پاک‌سازی دیده شود: `normalizeNumeric` علامت را
     دور می‌اندازد. `−` (U+2212) هم می‌آید چون صفحه‌کلیدهای فارسی آن را
     تولید می‌کنند. */
  if (text.startsWith("-") || text.startsWith("−")) return 0;
  const s = normalizeNumeric(text);
  if (!s || s === ".") return 0;
  const [head, ...rest] = s.split(".");
  const n = Number(rest.length ? `${head}.${rest.join("")}` : head);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundQty(n);
}

/** گردکردن به دو رقمِ اعشار، هم‌خوان با `Decimal.quantize(ROUND_HALF_UP)`
 *  سمتِ سرور.
 *
 *  شیفتِ اعشار روی **رشته** انجام می‌شود نه با ضرب در ۱۰۰، و این عمدی
 *  است: در دابل، `1.005 * 100` می‌شود `100.49999999999999` و `Math.round`
 *  آن را ۱۰۰ می‌کند — یعنی ۱٫۰۰ به‌جای ۱٫۰۱، که با سرور نمی‌خواند. ولی
 *  `Number("1.005e2")` دقیقاً ۱۰۰٫۵ است چون در مبنای دو نمایش‌پذیر است.
 *
 *  (برای عددِ منفی `Math.round` به‌سمتِ +∞ گرد می‌کند و با ROUND_HALF_UP
 *  یکی نیست؛ این‌جا مهم نیست چون تعداد و آستانه هرگز منفی نمی‌شوند.) */
export function roundQty(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const text = String(n);
  /* عددِ خیلی کوچک/بزرگ در JS نمایشِ نمایی دارد («1e-7») و چسباندنِ
     «e2» به آن NaN می‌سازد؛ در آن حالت به راهِ ضربی برمی‌گردیم. */
  if (text.includes("e") || text.includes("E")) {
    const f = 10 ** QTY_DECIMALS;
    return Math.round(n * f) / f;
  }
  return Number(
    `${Math.round(Number(`${text}e${QTY_DECIMALS}`))}e-${QTY_DECIMALS}`,
  );
}

/** عدد → نمایشِ فارسی بدونِ صفرِ انتهایی: ۲ → «۲» · ۱٫۵ → «۱٫۵» */
export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "۰";
  const fixed = roundQty(n).toFixed(QTY_DECIMALS);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
  return toFa(trimmed.replace(".", "٫"));
}

/** قالبِ زندهٔ ورودیِ تعداد — «۲٫» وسطِ تایپ نباید حذف شود، وگرنه کاربر
 *  هیچ‌وقت نمی‌تواند اعشار وارد کند. */
export function liveFormatQty(raw: string): string {
  const s = normalizeNumeric(raw);
  if (!s) return "";
  const [head, ...rest] = s.split(".");
  const intPart = head.replace(/^0+(?=\d)/, "") || "0";
  if (!rest.length) return toFa(s.includes(".") ? `${intPart}٫` : intPart);
  return toFa(`${intPart}٫${rest.join("").slice(0, QTY_DECIMALS)}`);
}

/** آیا این قلم زیرِ آستانه است؟
 *
 *  **آستانهٔ صفر یعنی «بی‌آستانه»** و هرگز کم شمرده نمی‌شود. قلمی که کاربر
 *  آستانه‌اش را تعیین نکرده نباید خودسرانه زنگ بزند — همین قاعده در
 *  `backend/app/services/inventory.py::is_low` هم هست و دو طرف باید
 *  یکی بمانند. */
export function isLow(item: InventoryItem): boolean {
  return item.threshold > 0 && item.quantity <= item.threshold;
}

/** اقلامِ کم‌شده — ورودیِ اعلانِ `InventoryBelowThreshold` (§۴.۹ و §۷.۱). */
export function lowItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter(isLow);
}

/** اقلامِ تیک‌خوردهٔ یک لیست — همان‌هایی که «خرید انجام شد» می‌بندد. */
export function checkedOf(list: ShoppingList): ShoppingItem[] {
  return list.items.filter((i) => i.checked);
}

/** جمعِ قیمتِ اقلام — بی‌قیمت‌ها صفر حساب می‌شوند، نه حذف.
 *
 *  صفرشدنِ جمع یعنی «هیچ قیمتی وارد نشده»، و در آن حالت بستنِ سفر عمداً
 *  تراکنشی نمی‌سازد (سرور هم همین کار را می‌کند). */
export function sumPrice(items: ShoppingItem[]): number {
  return items.reduce((s, i) => s + (i.price ?? 0), 0);
}

export interface ListSummary {
  /** تعدادِ اقلامِ نخریده (کلِ لیست) */
  pending: number;
  /** از آن‌ها، چندتا تیک خورده‌اند */
  checked: number;
  /** تومان — جمعِ قیمتِ تیک‌خورده‌ها */
  checkedTotal: number;
  /** چندتا از تیک‌خورده‌ها قیمت ندارند (برای هشدارِ «جمع ناقص است») */
  missingPrice: number;
}

export function summarize(list: ShoppingList): ListSummary {
  const checked = checkedOf(list);
  return {
    pending: list.items.length,
    checked: checked.length,
    checkedTotal: sumPrice(checked),
    missingPrice: checked.filter((i) => i.price === null).length,
  };
}

/** تعدادِ کلِ اقلامِ نخریده در همهٔ لیست‌ها — زیرنویسِ کاشیِ هاب. */
export function totalPending(lists: ShoppingList[]): number {
  return lists.reduce((s, l) => s + l.items.length, 0);
}

/** اقلامِ انبار که قلمِ نخریده‌ای در لیست‌ها به آن‌ها اشاره می‌کند.
 *
 *  برای این است که دکمهٔ «افزودن به لیست» دوباره پیشنهاد نشود؛ وگرنه
 *  کاربر هر بار که انبار را باز می‌کند یک «شیر» دیگر به لیست می‌افزود
 *  (و سرور با ۴۰۹ ردش می‌کرد، که تجربهٔ بدی است). */
export function queuedInventoryIds(lists: ShoppingList[]): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const item of list.items) {
      if (item.inventoryItemId) out.add(item.inventoryItemId);
    }
  }
  return out;
}
