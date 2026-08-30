/* نوار پیشرفت بودجه ماه جاری */

import type { BudgetStatus } from "@/domain/budget/budget.rules";
import { toFa } from "@/shared/lib/digits";

export function CheckBudgetStatus({ status }: { status: BudgetStatus | null }) {
  if (!status) return null;

  if (!status.active) {
    return (
      <div className="budget-progress">
        <div className="bp-head">
          <span>مصرف ماه جاری</span>
          <b>بدون بودجه</b>
        </div>
        <div className="bp-bar">
          <div className="bp-fill" style={{ width: "0%" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="budget-progress">
      <div className="bp-head">
        <span>مصرف ماه جاری</span>
        <b>{toFa(status.percent)}٪</b>
      </div>
      <div className="bp-bar">
        <div
          className={`bp-fill ${status.level === "over" ? "over" : status.level === "warn" ? "warn" : ""}`}
          style={{ width: `${Math.min(status.percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
