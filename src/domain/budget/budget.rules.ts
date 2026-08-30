/* قوانین دامنه بودجه — خالص و قابل تست */

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
