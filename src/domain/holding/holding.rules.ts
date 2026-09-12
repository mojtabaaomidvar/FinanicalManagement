/* قواعد دارایی — اعتبارسنجی و قالب‌بندیِ خالص (بدون وابستگی به React/IO).

   چرا پارسرِ جدا از parseAmountInput؟ آن تابع عمداً هر چیزِ غیر رقم را حذف
   می‌کند (`[^\d]`)، پس «۲٫۵ گرم» را ۲۵ می‌خواند. مقدارِ دارایی ذاتاً اعشاری
   است (۲٫۵ گرم طلا، ۰٫۰۳ بیت‌کوین)، پس این‌جا جداکنندهٔ اعشار را نگه
   می‌داریم. ستونِ دیتابیس Numeric(18,6) است و این قواعد دقیقاً با همان
   محدوده هم‌تراز شده‌اند تا خطا پیش از رفتن به سرور گرفته شود. */

import { toEn, toFa } from "@/shared/lib/digits";
import type { HoldingInput, HoldingKind } from "./holding.types";

/** شش رقمِ اعشار — هم‌سان با ستونِ Numeric(18,6) */
export const QUANTITY_DECIMALS = 6;
/** ۱۲ رقمِ صحیح — هم‌ارزِ همان ستون */
export const QUANTITY_MAX = 999_999_999_999;

const KINDS: readonly HoldingKind[] = ["gold", "currency", "crypto", "stock"];

/** برچسبِ فارسیِ هر دسته — یک منبعِ واحد برای همهٔ UI */
export const KIND_LABEL: Record<HoldingKind, string> = {
  gold: "طلا و سکه",
  currency: "ارز",
  crypto: "رمزارز",
  stock: "بورس",
};

/** واحدِ شمارشِ هر دسته — کنارِ عددِ مقدار می‌نشیند («۲ عدد»، «۳۰۰ واحد») */
export const KIND_UNIT: Record<HoldingKind, string> = {
  gold: "عدد",
  currency: "واحد",
  crypto: "واحد",
  stock: "سهم",
};

/* رشتهٔ ورودی → شکلِ استانداردِ انگلیسی با نقطهٔ اعشار.
   ٫ (U+066B) جداکنندهٔ اعشارِ فارسی است و به نقطه تبدیل می‌شود؛ ولی
   ٬ (U+066C) و ، (U+060C) جداکنندهٔ هزارند و باید حذف شوند — اگر این دو
   را هم اعشار می‌گرفتیم، «۱٬۲۰۰» به‌جای ۱۲۰۰ عددِ ۱٫۲ خوانده می‌شد. */
function normalize(raw: string): string {
  return toEn(String(raw))
    .replace(/٫/g, ".") // ٫ اعشارِ فارسی → نقطه
    .replace(/[٬،,\s_]/g, "") // ٬ ، و کاما/فاصله: جداکنندهٔ هزار
    .replace(/[^\d.]/g, ""); // هر چیزِ دیگر
}

/** ورودی مقدار (فارسی/اعشاری) → عدد؛ خالی یا نامعتبر → 0.
    چند نقطه؟ فقط اولی جداکنندهٔ اعشار است و بقیه نادیده گرفته می‌شوند
    تا «۱.۲.۳» به‌جای NaN، ۱٫۲۳ خوانده شود. */
export function parseQuantityInput(raw: string): number {
  const s = normalize(raw);
  if (!s || s === ".") return 0;
  const [head, ...rest] = s.split(".");
  const body = rest.length ? `${head}.${rest.join("")}` : head;
  const n = Number(body);
  return Number.isFinite(n) ? n : 0;
}

/** قالب‌بندیِ زندهٔ ورودی: ارقام فارسی + نگه‌داشتنِ جداکنندهٔ اعشار در حالِ تایپ.
    «۲.» نباید وسطِ تایپ حذف شود وگرنه کاربر نمی‌تواند اعشار وارد کند. */
export function liveFormatQuantity(raw: string): string {
  const s = normalize(raw);
  if (!s) return "";
  const [head, ...rest] = s.split(".");
  const intPart = head.replace(/^0+(?=\d)/, "") || "0";
  if (!rest.length) return toFa(intPart);
  const dec = rest.join("").slice(0, QUANTITY_DECIMALS);
  return toFa(`${intPart}٫${dec}`);
}

/** عدد → نمایشِ فارسی، بدون صفرِ انتهایی: 2 → «۲» ، 2.5 → «۲٫۵» */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return "۰";
  const fixed = n.toFixed(QUANTITY_DECIMALS);
  const trimmed = fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
  return toFa(trimmed.replace(".", "٫"));
}

/** مقدار را به دقتِ ستون گِرد می‌کند.
    پیش از ارسال لازم است: اگر عددِ درازتری برود، Postgres خودش گِرد می‌کند
    و «۰٫۰۰۰۰۰۰۱» به صفر تبدیل می‌شود و بعد CHECKِ quantity > 0 با خطای
    مبهمِ دیتابیس می‌ترکد — بهتر است همین‌جا صریح رد شود. */
export function roundQuantity(n: number): number {
  return Number(n.toFixed(QUANTITY_DECIMALS));
}

export type ValidationResult = { ok: boolean; error?: string };

/** اعتبارسنجیِ مقدار — کدهای خطا با پیام‌های یوزکیس نگاشت می‌شوند */
export function validateQuantity(n: number): ValidationResult {
  if (!Number.isFinite(n)) return { ok: false, error: "INVALID_QUANTITY" };
  const q = roundQuantity(n);
  if (q <= 0) return { ok: false, error: "ZERO_QUANTITY" };
  if (q > QUANTITY_MAX) return { ok: false, error: "HUGE_QUANTITY" };
  return { ok: true };
}

export function validateHoldingInput(input: HoldingInput): ValidationResult {
  if (!KINDS.includes(input.kind)) return { ok: false, error: "INVALID_KIND" };
  if (!input.name?.trim() || input.name.trim().length > 80) {
    return { ok: false, error: "INVALID_NAME" };
  }
  return validateQuantity(input.quantity);
}

/** نمادی که واقعاً ذخیره می‌شود.

    سرور نمادِ خالی را با نام پر می‌کند (بعضی ردیف‌های طلا/سکه در بالادست
    نماد ندارند و نام تنها چیزِ پایدارشان است). همان قاعده این‌جا تکرار
    می‌شود چون کلاینت باید بتواند ردیفِ موجود را پیدا کند؛ اگر دو طرف
    یکی نبودند، کاربر روی «سکهٔ امامی» می‌زد و به‌جای ویرایشِ ردیفِ موجود،
    ردیفِ تکراری ساخته می‌شد. */
export function effectiveSymbol(symbol: string, name: string): string {
  return (symbol || "").trim().slice(0, 40) || (name || "").trim();
}

/** ردیفِ موجودِ همین قلم را پیدا می‌کند — نبودش یعنی «تازه است».
    مقایسه با نمادِ مؤثر انجام می‌شود، نه نمادِ خام. */
export function findHolding<T extends { kind: HoldingKind; symbol: string }>(
  items: readonly T[],
  kind: HoldingKind,
  symbol: string,
  name: string,
): T | undefined {
  const want = effectiveSymbol(symbol, name);
  if (!want) return undefined;
  return items.find((h) => h.kind === kind && h.symbol === want);
}
