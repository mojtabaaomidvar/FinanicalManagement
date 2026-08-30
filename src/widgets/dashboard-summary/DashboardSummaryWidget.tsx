/* ویجت خلاصه داشبورد — موجودی، درآمد/هزینه ماه، نمودار حلقه‌ای، اخیر */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card, DonutChart, themeColors } from "@/shared/ui";
import { TxRow } from "@/features/transaction-list";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import {
  categoryBreakdown,
  monthTotals,
  recentTransactions,
  totalBalance,
} from "@/domain/report/report.rules";
import { today, formatMonth } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toFa } from "@/shared/lib/digits";
import type { TxFormModel } from "@/features/transaction-form";

export function DashboardSummaryWidget({
  form,
  onNavTransactions,
}: {
  form: TxFormModel;
  onNavTransactions: () => void;
}) {
  const { txs, members, family } = useApp();
  const [jy, jm] = today();

  const data = useMemo(() => {
    const mtx = txsInJalaliMonth(txs, jy, jm);
    return {
      balance: totalBalance(txs),
      totals: monthTotals(mtx),
      cats: categoryBreakdown(mtx),
      recent: recentTransactions(txs, 5),
    };
  }, [txs, jy, jm]);

  const palette = themeColors().palette;
  const slices = data.cats.slice(0, 8).map((c, i) => ({
    label: c.name,
    value: c.value,
    color: palette[i % palette.length],
  }));

  return (
    <>
      <div className="balance-card">
        <p className="balance-label">موجودی کل خانواده</p>
        <h2>
          {data.balance < 0 ? "−" : ""}
          {formatAmount(data.balance)}
        </h2>
        <p className="balance-sub">{family?.currency ?? "تومان"}</p>
        <div className="balance-mini">
          <div className="mini-item income">
            <span>درآمد ماه</span>
            <b>{formatAmount(data.totals.income)}</b>
          </div>
          <div className="mini-item expense">
            <span>هزینه ماه</span>
            <b>{formatAmount(data.totals.expense)}</b>
          </div>
        </div>
      </div>

      <Card
        title="هزینه‌های ماه جاری"
        action={<span className="badge">{formatMonth(jy, jm)}</span>}
      >
        <div className="donut-wrap">
          <DonutChart data={slices} />
          <div className="donut-center">
            <b>{formatAmount(data.totals.expense)}</b>
            <span>جمع هزینه</span>
          </div>
        </div>
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
      </Card>

      <Card
        title="تراکنش‌های اخیر"
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
                onClick={() => form.openEdit(t)}
              />
            ))
          ) : (
            <div className="empty-state" style={{ padding: "24px 8px" }}>
              <p>هنوز تراکنشی ثبت نشده</p>
              <p style={{ fontSize: 11.5, marginTop: 4 }}>
                برای شروع، دکمه سبز پایین را بزنید
              </p>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}
