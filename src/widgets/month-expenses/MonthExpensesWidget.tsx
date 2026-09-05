/* ویجت هزینه‌های ماه — نمودار حلقه‌ای/ستونی با ۴ دسته اصلی + «بقیه» */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { BarChart, Card, DonutChart, themeColors } from "@/shared/ui";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { categoryBreakdown, monthTotals } from "@/domain/report/report.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { MONTHS, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";

/** نوع نمودار هزینه ماه — انتخاب کاربر؛ در localStorage ماندگار است */
type ChartKind = "donut" | "bar";

const CHART_KINDS: { value: ChartKind; label: string }[] = [
  { value: "donut", label: "حلقه‌ای" },
  { value: "bar", label: "ستونی" },
];

const CHART_KEY = "khaneyar.chartKind";

/* فقط ۴ دسته پرخرج نمایش داده می‌شود؛ باقی در یک ردیف جمع می‌شود */
const TOP = 4;

function loadChartKind(): ChartKind {
  try {
    const v = localStorage.getItem(CHART_KEY);
    return v === "bar" ? "bar" : "donut";
  } catch {
    return "donut";
  }
}

export function MonthExpensesWidget() {
  const { txs, family, customCategories } = useApp();
  const cur = family?.currency ?? "تومان";
  const [jy, jm] = today();
  const [chartKind, setChartKind] = useState<ChartKind>(loadChartKind);

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  const data = useMemo(() => {
    const mtx = txsInJalaliMonth(txs, jy, jm);
    return { cats: categoryBreakdown(mtx, resolve), totals: monthTotals(mtx) };
  }, [txs, jy, jm, resolve]);

  /* رنگ‌ها هر رندر از توکن‌های CSS خوانده می‌شود تا با تغییر تم هم‌گام بماند */
  const C = themeColors();
  const slices = data.cats.slice(0, TOP).map((c, i) => ({
    label: c.name,
    value: toDisplay(c.value, cur),
    color: C.palette[i % C.palette.length],
  }));
  const restValue = data.cats
    .slice(TOP)
    .reduce((s, c) => s + toDisplay(c.value, cur), 0);
  if (restValue > 0) {
    slices.push({ label: "بقیه", value: restValue, color: C.text3 });
  }

  const totalExpense = toDisplay(data.totals.expense, cur);

  function switchChart(kind: ChartKind) {
    setChartKind(kind);
    try {
      localStorage.setItem(CHART_KEY, kind);
    } catch {
      /* حالت private browsing */
    }
  }

  return (
    <Card
      title={`هزینه‌های ${MONTHS[jm - 1]}`}
      action={
        <div className="chart-kind-switch">
          {CHART_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              className={`chart-kind-btn ${chartKind === k.value ? "active" : ""}`}
              onClick={() => switchChart(k.value)}
            >
              {k.label}
            </button>
          ))}
        </div>
      }
    >
      {chartKind === "donut" ? (
        <div className="donut-wrap">
          <DonutChart data={slices} size={230} />
          <div className="donut-center">
            <b>
              {formatAmount(totalExpense)}
              <span className="cur-tag">{cur}</span>
            </b>
            <span>جمع هزینه</span>
          </div>
        </div>
      ) : (
        <BarChart
          data={slices.map((s) => ({
            label: s.label.length > 10 ? s.label.slice(0, 10) + "…" : s.label,
            value: s.value,
          }))}
          height={190}
        />
      )}

      <div className="legend">
        {slices.length ? (
          slices.map((d) => (
            <div className="legend-item" key={d.label}>
              <span className="mini-dot" style={{ background: d.color }} />
              <span>{d.label}</span>
              <b>{formatAmount(d.value)}</b>
              <span className="pct">
                {toFa(
                  totalExpense ? Math.round((d.value / totalExpense) * 100) : 0,
                )}
                ٪
              </span>
            </div>
          ))
        ) : (
          <div className="legend-item">
            <span>این ماه هنوز هزینه‌ای ثبت نشده</span>
          </div>
        )}
      </div>
    </Card>
  );
}
