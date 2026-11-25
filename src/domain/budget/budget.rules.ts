/* قوانین دامنه بودجه — خالص و قابل تست */

import type { Transaction } from "../transaction/transaction.types";
import { isoToJalali, monthKey } from "@/shared/lib/jalali";
import { toEn } from "@/shared/lib/digits";
import { fromDisplay } from "@/shared/lib/currency";
import { addMoney, compareMoney, floorMoneyPerDay, legacyIntegerMoney, moneyRatio, subtractMoney, type Money } from "@/shared/lib/money";

export const MAX_CATEGORY_BUDGET = 999_999_999_999;
export const MAX_MONTHLY_BUDGET = 9_999_999_999_999;

/** Parse the whole-unit budget contract without discarding unsupported input. */
export function parseCategoryBudgetAmount(raw: string, currency: string): number | null {
  return parseBudgetAmount(raw, currency, MAX_CATEGORY_BUDGET, false);
}

export function parseMonthlyBudgetAmount(raw: string, currency: string): number | null {
  return parseBudgetAmount(raw, currency, MAX_MONTHLY_BUDGET, true);
}

function parseBudgetAmount(raw: string, currency: string, limit: number, allowZero: boolean): number | null {
  const normalized = toEn(raw).replace(/[,٬،]/g, "").trim();
  if (!/^\d+$/.test(normalized)) return null;
  const base = fromDisplay(Number(normalized), currency);
  const amount = Math.round(base);
  return Number.isFinite(base) && base <= limit && (amount > 0 || (allowZero && base === 0)) ? amount : null;
}

export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetStatus {
  /** بودجه فعال است (بزرگ‌تر از صفر) */
  active: boolean;
  /** درصد مصرف — سقف ۹۹۹ */
  percent: number;
  level: BudgetLevel;
}

export const BUDGET_WARN_PERCENT = 80;

export function budgetStatus(budget: number | Money, spent: Money): BudgetStatus {
  const cap = typeof budget === "number" ? legacyIntegerMoney(budget) : budget;
  if (compareMoney(cap, "0") <= 0) {
    return { active: false, percent: 0, level: "ok" };
  }
  const raw = moneyRatio(spent, cap) * 100;
  const percent = Math.min(Math.round(raw), 999);
  const level: BudgetLevel =
    raw > 100 ? "over" : raw > BUDGET_WARN_PERCENT ? "warn" : "ok";
  return { active: true, percent, level };
}

/** جمع هزینه‌های هر دسته در یک ماه جلالی — بودجه‌ها با تغییر ماه ریست می‌شوند */
export function monthCategorySpend(
  txs: Transaction[],
  jy: number,
  jm: number,
): Map<string, Money> {
  const key = monthKey(jy, jm);
  const spend = new Map<string, Money>();
  for (const tx of txs) {
    if (tx.type !== "expense") continue;
    const d = isoToJalali(tx.date);
    if (monthKey(d[0], d[1]) !== key) continue;
    spend.set(tx.category, addMoney(spend.get(tx.category) ?? "0", tx.amount));
  }
  return spend;
}

/** ظرفیت خرج باقیمانده ماه — جمع سقف بودجه‌ها منهای مصرف همان دسته‌ها */
export interface SpendCapacity {
  /** حداقل یک بودجه فعال تعیین شده است */
  active: boolean;
  /** جمع سقف بودجه‌های فعال */
  cap: Money;
  /** جمع مصرف دسته‌های بودجه‌دار در این ماه */
  spent: Money;
  /** All expenses, including categories without an active budget. */
  totalSpent: Money;
  unbudgetedSpent: Money;
  /** cap − spent — منفی یعنی عبور از سقف */
  remaining: Money;
  /** درصد مصرف — سقف ۹۹۹ */
  percent: number;
  level: BudgetLevel;
  /** روزهای مانده تا پایان ماه (شامل امروز) */
  daysLeft: number;
  /** سهم روزانه باقیمانده — عبور از سقف → صفر */
  perDay: Money;
}

export function spendCapacity(
  budgets: { category: string; amount: number }[],
  spend: Map<string, Money>,
  daysLeft: number,
): SpendCapacity {
  let cap = "0";
  let spent = "0";
  const covered = new Set<string>();
  for (const b of budgets) {
    if (!b.amount || b.amount <= 0) continue;
    cap = addMoney(cap, legacyIntegerMoney(b.amount));
    spent = addMoney(spent, spend.get(b.category) ?? "0");
    covered.add(b.category);
  }
  const totalSpent = addMoney(...spend.values());
  const unbudgetedSpent = addMoney(...[...spend.entries()].map(([category, amount]) => covered.has(category) ? "0" : amount));
  const st = budgetStatus(cap, spent);
  const remaining = subtractMoney(cap, spent);
  const days = Math.max(1, daysLeft);
  return {
    active: st.active,
    cap,
    spent,
    totalSpent,
    unbudgetedSpent,
    remaining,
    percent: st.percent,
    level: st.level,
    daysLeft: days,
    perDay: compareMoney(remaining, "0") > 0 ? floorMoneyPerDay(remaining, days) : "0",
  };
}
