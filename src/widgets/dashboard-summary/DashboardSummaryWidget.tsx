/* ویجت خلاصه داشبورد — کارت مالی بازطراحی‌شده (موجودی + روند ماه)،
   نمودار هزینه ماه با نوع انتخابی کاربر، ۳ تراکنش آخر */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card, BarChart, DonutChart, themeColors } from "@/shared/ui";
import { TxRow } from "@/features/transaction-list";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import {
  categoryBreakdown,
  monthTotals,
  recentTransactions,
  totalBalance,
} from "@/domain/report/report.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { today, formatMonth } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { TxFormModel } from "@/features/transaction-form";

/** نوع نمودار هزینه ماه — انتخاب کاربر؛ در localStorage ماندگار است */
type ChartKind = "donut" | "bar";

const CHART_KINDS: { value: ChartKind; label: string }[] = [
  { value: "donut", label: "حلقه‌ای" },
  { value: "bar", label: "ستونی" },
];

const CHART_KEY = "khaneyar.chartKind";

function loadChartKind(): ChartKind {
  try {
    const v = localStorage.getItem(CHART_KEY);
    return v === "bar" ? "bar" : "donut";
  } catch {
    return "donut";
  }
}

export function DashboardSummaryWidget({
  form,
  onNavTransactions,
}: {
  form: TxFormModel;
  onNavTransactions: () => void;
}) {
  const { txs, members, family, subcategories, customCategories } = useApp();
  const [jy, jm] = today();
  const [chartKind, setChartKind] = useState<ChartKind>(loadChartKind);

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  const data = useMemo(() => {
    const mtx = txsInJalaliMonth(txs, jy, jm);
    return {
      balance: totalBalance(txs),
      totals: monthTotals(mtx),
      cats: categoryBreakdown(mtx, resolve),
      recent: recentTransactions(txs, 3),
    };
  }, [txs, jy, jm, resolve]);

  const palette = themeColors().palette;
  const cur = family?.currency ?? "تومان";
  const slices = data.cats.slice(0, 8).map((c, i) => ({
    label: c.name,
    value: toDisplay(c.value, cur),
    color: palette[i % palette.length],
  }));

  /* مانده ماه = درآمد − هزینه (خروج ماه) */
  const monthNet = data.totals.income - data.totals.expense;

  function switchChart(kind: ChartKind) {
    setChartKind(kind);
    try {
      localStorage.setItem(CHART_KEY, kind);
    } catch {
      /* حالت private browsing */
    }
  }

  return (
    <>
      {/* ── کارت مالی اصلی (بازطراحی v7) ── */}
      <div className="fin-hero">
        <div className="fin-hero-top">
          <p className="fin-hero-label">موجودی کل خانواده</p>
          <h2
            className="fin-hero-balance"
            style={data.balance < 0 ? { color: "var(--danger)" } : undefined}
          >
            {formatAmount(toDisplay(data.balance, cur))}
            <span className="fin-hero-cur">{cur}</span>
          </h2>
        </div>
        <div className="fin-hero-grid">
          <div className="fin-cell">
            <span className="fin-cell-label">
              <i className="fin-dot income" />
              درآمد ماه
            </span>
            <b className="fin-cell-value income">
              {formatAmount(toDisplay(data.totals.income, cur))}
            </b>
          </div>
          <div className="fin-cell">
            <span className="fin-cell-label">
              <i className="fin-dot expense" />
              هزینه ماه
            </span>
            <b className="fin-cell-value expense">
              {formatAmount(toDisplay(data.totals.expense, cur))}
            </b>
          </div>
          <div className="fin-cell wide">
            <span className="fin-cell-label">مانده ماه</span>
            <b
              className={`fin-cell-value net ${monthNet >= 0 ? "income" : "expense"}`}
            >
              {monthNet >= 0 ? "＋" : "−"}
              {formatAmount(toDisplay(Math.abs(monthNet), cur))}
            </b>
          </div>
        </div>
      </div>

      {/* ── نمودار هزینه‌های ماه — نوع انتخابی کاربر ── */}
      <Card
        title="هزینه‌های ماه جاری"
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
            <DonutChart data={slices} />
            <div className="donut-center">
              <b>{formatAmount(toDisplay(data.totals.expense, cur))}</b>
              <span>جمع هزینه</span>
            </div>
          </div>
        ) : (
          <BarChart
            data={slices.map((s) => ({
              label: s.label.length > 10 ? s.label.slice(0, 10) + "…" : s.label,
              value: s.value,
            }))}
            height={200}
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
                    data.totals.expense
                      ? Math.round((d.value / data.totals.expense) * 100)
                      : 0,
                  )}
                  ٪
                </span>
              </div>
            ))
          ) : (
            <div className="legend-item">
              <span>هنوز هزینه‌ای ثبت نشده</span>
            </div>
          )}
        </div>
        <p className="chart-kind-hint">{formatMonth(jy, jm)}</p>
      </Card>

      {/* ── ۳ تراکنش آخر ── */}
      <Card
        title="آخرین تراکنش‌ها"
        action={
          <button className="link-btn" onClick={onNavTransactions}>
            مشاهده همه
          </button>
        }
      >
        <div className="tx-list">
          {data.recent.length ? (
            data.recent.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                currency={family?.currency ?? ""}
                memberName={
                  members.find((x) => x.id === t.memberId)?.name ?? "—"
                }
                subcategoryName={
                  t.subcategoryId
                    ? subcategories.find((s) => s.id === t.subcategoryId)?.name ?? null
                    : null
                }
                resolve={resolve}
                onClick={() => form.openEdit(t)}
              />
            ))
          ) : (
            <div className="empty-state" style={{ padding: "24px 8px" }}>
              <p>هنوز تراکنشی ثبت نشده</p>
              <p style={{ fontSize: 11.5, marginTop: 4 }}>
                برای شروع، دکمه سبز + پایین صفحه را بزنید
              </p>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
