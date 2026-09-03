/* قوانین دامنه بودجه — خالص و قابل تست */

import type { Transaction } from "../transaction/transaction.types";
import { isoToJalali, monthKey } from "@/shared/lib/jalali";

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
