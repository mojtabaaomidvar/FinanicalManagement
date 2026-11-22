/* قوانین دامنه بودجه — خالص و قابل تست */

import type { Transaction } from "../transaction/transaction.types";
import { isoToJalali, monthKey } from "@/shared/lib/jalali";
import { toEn } from "@/shared/lib/digits";
import { fromDisplay } from "@/shared/lib/currency";

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

export function budgetStatus(budget: number, spent: number): BudgetStatus {
  if (!budget || budget <= 0) {
    return { active: false, percent: 0, level: "ok" };
  }
  const raw = (spent / budget) * 100;
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
): Map<string, number> {
  const key = monthKey(jy, jm);
  const spend = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type !== "expense") continue;
    const d = isoToJalali(tx.date);
    if (monthKey(d[0], d[1]) !== key) continue;
    spend.set(tx.category, (spend.get(tx.category) ?? 0) + tx.amount);
  }
  return spend;
}

/** ظرفیت خرج باقیمانده ماه — جمع سقف بودجه‌ها منهای مصرف همان دسته‌ها */
export interface SpendCapacity {
  /** حداقل یک بودجه فعال تعیین شده است */
  active: boolean;
  /** جمع سقف بودجه‌های فعال */
  cap: number;
  /** جمع مصرف دسته‌های بودجه‌دار در این ماه */
  spent: number;
  /** All expenses, including categories without an active budget. */
  totalSpent: number;
  unbudgetedSpent: number;
  /** cap − spent — منفی یعنی عبور از سقف */
  remaining: number;
  /** درصد مصرف — سقف ۹۹۹ */
  percent: number;
  level: BudgetLevel;
  /** روزهای مانده تا پایان ماه (شامل امروز) */
  daysLeft: number;
  /** سهم روزانه باقیمانده — عبور از سقف → صفر */
  perDay: number;
}

export function spendCapacity(
  budgets: { category: string; amount: number }[],
  spend: Map<string, number>,
  daysLeft: number,
): SpendCapacity {
  let cap = 0;
  let spent = 0;
  const covered = new Set<string>();
  for (const b of budgets) {
    if (!b.amount || b.amount <= 0) continue;
    cap += b.amount;
    spent += spend.get(b.category) ?? 0;
    covered.add(b.category);
  }
  const totalSpent = [...spend.values()].reduce((sum, amount) => sum + amount, 0);
  const unbudgetedSpent = [...spend.entries()].reduce((sum, [category, amount]) => sum + (covered.has(category) ? 0 : amount), 0);
  const st = budgetStatus(cap, spent);
  const remaining = cap - spent;
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
    perDay: remaining > 0 ? Math.floor(remaining / days) : 0,
  };
}
