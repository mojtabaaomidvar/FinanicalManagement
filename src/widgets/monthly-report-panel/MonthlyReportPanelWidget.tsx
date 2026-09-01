/* ویجت پنل گزارش ماهانه — ستونی روزانه، خطی ۶ ماهه، دسته‌بندی */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { BarChart, Card, LineChart, themeColors } from "@/shared/ui";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import {
  categoryBreakdown,
  dailyExpenses,
  monthTotals,
  sixMonthSeries,
} from "@/domain/report/report.rules";
import { today, formatMonth, nextMonth, prevMonth } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { toDisplay } from "@/shared/lib/currency";
import { formatAmount, formatPercent } from "@/shared/lib/format";

export function MonthlyReportPanelWidget() {
  const { txs, family } = useApp();
  const cur = family?.currency ?? "تومان";
  const [jy, setJy] = useState(() => today()[0]);
  const [jm, setJm] = useState(() => today()[1]);

  const report = useMemo(() => {
    const mtx = txsInJalaliMonth(txs, jy, jm);
    return {
      daily: dailyExpenses(mtx),
      series: sixMonthSeries((y, m) => txsInJalaliMonth(txs, y, m), jy, jm),
      cats: categoryBreakdown(mtx),
      total: monthTotals(mtx).expense,
    };
  }, [txs, jy, jm]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const C = themeColors();

  return (
    <>
      <div className="month-nav">
        <button
          className="icon-btn small"
          aria-label="ماه قبل"
          onClick={() => {
            const [y, m] = prevMonth(jy, jm);
            setJy(y);
            setJm(m);
          }}
        >
          <svg>
            <use href="#i-arrow-r" />
          </svg>
        </button>
        <span>{formatMonth(jy, jm)}</span>
        <button
          className="icon-btn small"
          aria-label="ماه بعد"
          onClick={() => {
            const [y, m] = nextMonth(jy, jm);
            setJy(y);
            setJm(m);
          }}
        >
          <svg>
            <use href="#i-arrow-l" />
          </svg>
        </button>
      </div>

      <Card
        title="روند روزانه"
        action={<span className="badge">{family?.currency ?? "تومان"}</span>}
      >
        <div className="chart-box">
          <BarChart
            data={
              report.daily.length
                ? report.daily.map((d) => ({
                    label: toFa(d.day),
                    value: toDisplay(d.value, cur),
                  }))
                : [{ label: "—", value: 0 }]
            }
          />
        </div>
      </Card>

      <Card title="مقایسه ۶ ماه اخیر">
        <div className="chart-box">
          <LineChart
            labels={report.series.labels}
            series={[
              {
                values: report.series.income.map((v) => toDisplay(v, cur)),
                color: C.income,
                kind: "income",
              },
              {
                values: report.series.expense.map((v) => toDisplay(v, cur)),
                color: C.expense,
                kind: "expense",
              },
            ]}
          />
        </div>
        <div className="legend horiz">
          <div className="legend-item">
            <span className="mini-dot income" />
            درآمد
          </div>
          <div className="legend-item">
            <span className="mini-dot expense" />
            هزینه
          </div>
        </div>
      </Card>

      <Card title="هزینه به تفکیک دسته">
        <div className="cat-report">
          {report.cats.length ? (
            report.cats.map((c, i) => {
              const color = C.palette[i % C.palette.length];
              const pct = report.total
                ? Math.round((c.value / report.total) * 100)
                : 0;
              return (
                <div className="cat-row" key={c.id}>
                  <div className="cat-row-top">
                    <span className="mini-dot" style={{ background: color }} />
                    <span>{c.name}</span>
                    <b>{formatAmount(toDisplay(c.value, cur))}</b>
                    <span className="pct">{formatPercent(pct)}</span>
                  </div>
                  <div className="cat-bar">
                    <div
                      className="cat-bar-fill"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p
              style={{
                fontSize: 13,
                color: "var(--text-3)",
                textAlign: "center",
                padding: "16px 0",
              }}
            >
              هزینه‌ای در این ماه ثبت نشده
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
