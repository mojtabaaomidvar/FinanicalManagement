/* ویجت دایره‌های بودجه — حلقه پیشرفت پاستلی هر دسته + افزودن بودجه */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card } from "@/shared/ui";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { categoryColor } from "@/domain/category/category.colors";
import { budgetStatus, monthCategorySpend } from "@/domain/budget/budget.rules";
import { today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";

const R = 26;
const CIRC = 2 * Math.PI * R;

export function BudgetCirclesWidget({ onManage }: { onManage: () => void }) {
  const { family, txs, budgets, customCategories } = useApp();
  const cur = family?.currency ?? "تومان";
  const [jy, jm] = today();

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  const items = useMemo(() => {
    const spend = monthCategorySpend(txs, jy, jm);
    return budgets
      .map((b) => {
        const spent = spend.get(b.category) ?? 0;
        return {
          id: b.category,
          name: resolve(b.category).name,
          color: categoryColor(b.category),
          spent,
          cap: b.amount,
          st: budgetStatus(b.amount, spent),
        };
      })
      .sort((a, b) => b.st.percent - a.st.percent);
  }, [budgets, txs, jy, jm, resolve]);

  return (
    <Card
      title="بودجه‌های دسته‌ها"
      action={
        <button className="link-btn" onClick={onManage}>
          مدیریت
        </button>
      }
    >
      <div className="budget-circles">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className="budget-circle"
            onClick={onManage}
          >
            <svg viewBox="0 0 64 64" className="ring">
              <circle className="ring-track" cx="32" cy="32" r={R} />
              <circle
                className="ring-fill"
                cx="32"
                cy="32"
                r={R}
                stroke={it.color}
                strokeDasharray={`${(Math.min(it.st.percent, 100) / 100) * CIRC} ${CIRC}`}
                style={{
                  transition: "stroke-dasharray 0.6s var(--ease-out)",
                }}
              />
              <text x="32" y="37" className="ring-pct">
                {toFa(Math.min(it.st.percent, 999))}٪
              </text>
            </svg>
            <b>{it.name}</b>
            <span>
              {formatAmount(toDisplay(it.spent, cur))} از{" "}
              {formatAmount(toDisplay(it.cap, cur))}
              <span className="cur-tag">{cur}</span>
            </span>
          </button>
        ))}

        <button
          type="button"
          className="budget-circle add"
          onClick={onManage}
        >
          <span className="budget-add-plus">
            <svg>
              <use href="#i-plus" />
            </svg>
          </span>
          <b>افزودن بودجه جدید</b>
        </button>
      </div>

      {!items.length ? (
        <p className="budget-circles-hint">
          برای هر دسته هزینه یک سقف ماهانه تعیین کن تا مصرفش را همین‌جا ببینی
        </p>
      ) : null}
    </Card>
  );
}
