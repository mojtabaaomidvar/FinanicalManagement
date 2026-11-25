/* کیپد ماشین‌حساب مبلغ — چیدمان ۴×۴ پیل: رقم‌ها + عملگرها در ستون چهارم
   فشردن عملگر پس از عبارت کامل، نتیجه را همان‌جا می‌گذارد (محاسبه inline)؛
   ارزیابی امن دو-گذره بدون eval (اولویت ضرب/تقسیم، سپس جمع/تفریق) */

import { toEn, toFa } from "@/shared/lib/digits";
import { divideMoney, formatMoney, type Money } from "@/shared/lib/money";

/** Normalize keyboard notation without discarding invalid input or changing its value. */
export function normalizeExpressionInput(raw: string): string {
  const normalized = toEn(raw)
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/−/g, "-")
    .replace(/٫/g, ".")
    .replace(/[٬،]/g, ",");
  // Group each operand as text, retaining leading zeroes, decimals and partial expressions.
  if (!/^-?[\d,]*(?:\.\d*)?(?:[+\-×÷][\d,]*(?:\.\d*)?)*$/.test(normalized)) return toFa(normalized);
  return toFa(normalized.replace(/[\d,]+(?:\.\d*)?/g, operand => {
    const [integer, fraction] = operand.split(".");
    const grouped = integer.replace(/,/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return grouped + (fraction === undefined ? "" : "." + fraction);
  }));
}

/** Restore a caret by meaningful characters rather than the inserted separators. */
export function expressionInputCaret(raw: string, formatted: string, offset: number): number {
  const before = raw.slice(0, offset).replace(/[,٬،]/g, "").length;
  let position = 0, count = 0;
  while (position < formatted.length && count < before) {
    if (formatted[position] !== ",") count++;
    position++;
  }
  if (/[,٬،]/.test(raw[offset - 1] ?? "") && formatted[position] === ",") position++;
  return position;
}

/** Preserve fractional values, including small decimals, when continuing an expression. */
export function formatExpressionValue(value: number | Money): string {
  if (typeof value === "string") return formatMoney(value, "تومان");
  return toFa(value.toLocaleString("en-US", { maximumSignificantDigits: 21 }));
}

/** ارزیابی امن عبارت «a±×÷b±×÷c…» — اولویت ضرب/تقسیم، سپس جمع/تفریق */
export function evaluateExpression(raw: string): Money | null {
  const s = toEn(raw).replace(/,/g, "").replace(/\s+/g, "");
  if (!s || raw.length > 1024 || s.length > 512) return null;
  if (!/^-?\d+(?:\.\d+)?(?:[+\-×÷]\d+(?:\.\d+)?)*$/.test(s)) return null;

  const tokens = s.match(/\d+(?:\.\d+)?|[+\-×÷]/g);
  if (!tokens || tokens.length === 0) return null;
  const start = tokens[0] === "-" ? 1 : 0;
  if (!/^\d/.test(tokens[start] ?? "")) return null;

  // Keep rational intermediates: 1÷3×3 and 1÷3+2÷3 cancel exactly.
  // Only a finite final decimal may become an amount; nothing is rounded.
  type Fraction = { n: bigint; d: bigint };
  function reduce(n: bigint, d: bigint): Fraction {
    if (d === 0n) throw new Error("Division by zero");
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) { const remainder = a % b; a = b; b = remainder; }
    return { n: n / a, d: d / a };
  }
  function operand(value: string): Fraction {
    if (value.length > 128) throw new Error("Operand too long");
    const [integer, fraction = ""] = value.split(".");
    return reduce(BigInt(integer + fraction), 10n ** BigInt(fraction.length));
  }
  function sum(a: Fraction, b: Fraction, sign: bigint): Fraction {
    return reduce(a.n * b.d + sign * b.n * a.d, a.d * b.d);
  }
  try {
    let total: Fraction = { n: 0n, d: 1n };
    let sign = start === 1 ? -1n : 1n;
    let term = operand(tokens[start]);
    for (let i = start + 1; i < tokens.length;) {
      const op = tokens[i++], value = tokens[i++];
      if (value === undefined) return null;
      const next = operand(value);
      if (op === "×") term = reduce(term.n * next.n, term.d * next.d);
      else if (op === "÷") term = reduce(term.n * next.d, term.d * next.n);
      else { total = sum(total, term, sign); sign = op === "+" ? 1n : -1n; term = next; }
    }
    const result = sum(total, term, sign);
    const amount = divideMoney(result.n.toString(), result.d.toString());
    return amount !== null && amount.length <= 128 ? amount : null;
  } catch { return null; }
}

const KEYS = [
  "۱", "۲", "۳", "÷",
  "۴", "۵", "۶", "×",
  "۷", "۸", "۹", "-",
  "۰۰۰", "۰", "⌫", "+",
] as const;

const OPS = ["+", "-", "×", "÷"] as const;

export function CalcKeypad({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  function press(k: string) {
    if (k === "⌫") {
      onChange(value.slice(0, -1));
      return;
    }
    if (k === "۰۰۰") {
      // Extend the current number without joining operands across an operator.
      onChange(value ? value + k : "");
      return;
    }
    if ((OPS as readonly string[]).includes(k)) {
      if (!value) return;
      const last = value.slice(-1);
      if ((OPS as readonly string[]).includes(last)) {
        /* جایگزینی عملگر قبلی */
        onChange(value.slice(0, -1) + k);
        return;
      }
      /* عبارت کامل → نتیجه + عملگر جدید (محاسبه inline) */
      if ((OPS as readonly string[]).some((op) => value.includes(op))) {
        const r = evaluateExpression(value);
        if (r !== null) {
          onChange(formatExpressionValue(r) + k);
          return;
        }
      }
      onChange(value + k);
      return;
    }
    onChange(value + k);
  }

  return (
    <div className="calc-pad" dir="ltr">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`calc-key ${(OPS as readonly string[]).includes(k) ? "op" : ""} ${k === "⌫" ? "back" : ""}`}
          aria-label={k === "⌫" ? "پاک‌کردن رقم آخر" : `درج ${k}`}
          onClick={() => press(k)}
        >
          {k}
        </button>
      ))}
    </div>
  );
}
