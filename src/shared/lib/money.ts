/* Exact decimal strings at JSON boundaries; BigInt coefficients for arithmetic.
 * No currency label is a stored amount, and no parsed API value passes through Number.
 */
import { toEn, toFa } from "./digits";
import type { CurrencyCode } from "./currency";

export type Money = string;
interface DecimalParts { coefficient: bigint; scale: number }

function parts(value: Money): DecimalParts {
  if (typeof value !== "string") throw new Error("Invalid exact decimal");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || value.length > 128) throw new Error("Invalid exact decimal");
  const fraction = match[3] ?? "";
  return { coefficient: BigInt(match[2] + fraction) * (match[1] ? -1n : 1n), scale: fraction.length };
}

function decimal(coefficient: bigint, scale: number): Money {
  if (coefficient === 0n) return "0";
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  const unsigned = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "") : digits;
  return (negative ? "-" : "") + unsigned;
}

export function normalizeMoney(value: Money): Money {
  const { coefficient, scale } = parts(value);
  return decimal(coefficient, scale);
}

export function addMoney(...values: Money[]): Money {
  const items = values.map(parts);
  const scale = Math.max(0, ...items.map(item => item.scale));
  return decimal(items.reduce((total, item) => total + item.coefficient * 10n ** BigInt(scale - item.scale), 0n), scale);
}

export function negateMoney(value: Money): Money {
  const item = parts(value);
  return decimal(-item.coefficient, item.scale);
}

export function absMoney(value: Money): Money {
  const item = parts(value);
  return decimal(item.coefficient < 0n ? -item.coefficient : item.coefficient, item.scale);
}

/** Validate the destination's precision and range before sending a write. */
export function moneyFits(value: Money, options: { scale: number; min?: Money; max?: Money }): boolean {
  try {
    const normalized = normalizeMoney(value);
    return parts(normalized).scale <= options.scale
      && (options.min === undefined || compareMoney(normalized, options.min) >= 0)
      && (options.max === undefined || compareMoney(normalized, options.max) <= 0);
  } catch { return false; }
}

export function subtractMoney(left: Money, right: Money): Money {
  return addMoney(left, negateMoney(right));
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  const difference = parts(subtractMoney(left, right)).coefficient;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function multiplyMoney(left: Money, right: Money): Money {
  const a = parts(left), b = parts(right);
  return decimal(a.coefficient * b.coefficient, a.scale + b.scale);
}

/** Exact finite decimal division. Non-terminating results cannot become money. */
export function divideMoney(left: Money, right: Money): Money | null {
  const a = parts(left), b = parts(right);
  if (b.coefficient === 0n) return null;
  let n = a.coefficient * 10n ** BigInt(b.scale), d = b.coefficient * 10n ** BigInt(a.scale);
  if (d < 0n) { n = -n; d = -d; }
  let x = n < 0n ? -n : n, y = d;
  while (y) { const remainder = x % y; x = y; y = remainder; }
  n /= x; d /= x;
  let twos = 0, fives = 0;
  while (d % 2n === 0n) { d /= 2n; twos++; }
  while (d % 5n === 0n) { d /= 5n; fives++; }
  if (d !== 1n) return null;
  const scale = Math.max(twos, fives);
  if (scale > 100) return null;
  return decimal(n * 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives), scale);
}

/** Whole-toman daily allowance, explicitly floored for display, never persisted. */
export function floorMoneyPerDay(value: Money, days: number): Money {
  if (!Number.isSafeInteger(days) || days <= 0) throw new Error("Invalid days");
  const { coefficient, scale } = parts(value);
  const divisor = 10n ** BigInt(scale) * BigInt(days);
  const whole = coefficient / divisor;
  return decimal(coefficient < 0n && coefficient % divisor !== 0n ? whole - 1n : whole, 0);
}

/** Geometric ratios only: exact operands first, bounded normalized coordinate last.
 * This is not a monetary result and must never be used as a saved amount.
 */
export function moneyRatio(numerator: Money, denominator: Money): number {
  const a = parts(numerator), b = parts(denominator);
  if (b.coefficient === 0n) return 0;
  const scaled = a.coefficient * 10n ** BigInt(b.scale) * 1_000_000n / (b.coefficient * 10n ** BigInt(a.scale));
  // Presentation ratios saturate, rather than crashing a report with a tiny base.
  const bound = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(scaled > bound ? bound : scaled < -bound ? -bound : scaled) / 1_000_000;
}

/** Only legacy integer API contracts may cross this boundary. Fractions and
 * unsafe numbers fail closed instead of pretending to reconstruct exact money.
 */
export function legacyIntegerMoney(value: number): Money {
  if (!Number.isSafeInteger(value)) throw new Error("Invalid legacy integer money");
  return String(value);
}

/** Isolated legacy whole-toman budget writer; never for financial ledger amounts. */
export function legacyBudgetInteger(value: Money): number {
  if (!moneyFits(value, { scale: 0, min: "0", max: String(Number.MAX_SAFE_INTEGER) })) throw new Error("Invalid legacy budget integer");
  return Number(value);
}

export function convertMoney(toman: Money, currency: CurrencyCode | string): Money {
  return currency === "ریال" ? multiplyMoney(toman, "10") : normalizeMoney(toman);
}

export function formatMoney(toman: Money, currency: CurrencyCode | string): string {
  const [integer, fraction] = convertMoney(toman, currency).split(".");
  return toFa(integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? "." + fraction : ""));
}

export function parseMoneyInput(raw: string, currency: CurrencyCode | string): Money | null {
  const text = toEn(raw).trim().replace(/٫/g, ".");
  // Group separators must separate groups, not hide operators or arbitrary text.
  if (!/^-?(?:\d+|\d{1,3}(?:[,٬، ]\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  try {
    const item = parts(text.replace(/[,٬، ]/g, ""));
    const toman = decimal(item.coefficient, item.scale + (currency === "ریال" ? 1 : 0));
    return parts(toman).scale > 2 ? null : toman;
  } catch { return null; }
}
