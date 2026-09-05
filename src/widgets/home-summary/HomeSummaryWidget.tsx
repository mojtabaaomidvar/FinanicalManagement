/* ویجت پنل خلاصه خانه — موجودی کل، دفتر ماه با مقایسه ماه گذشته،
   و متر «قابل خرج تا پایان ماه» بر پایه سقف بودجه‌ها */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import {
  deltaPercent,
  monthTotals,
  totalBalance,
} from "@/domain/report/report.rules";
import {
  txsInJalaliMonth,
  txsInJalaliMonthUpToDay,
} from "@/domain/transaction/transaction.rules";
import {
  monthCategorySpend,
  spendCapacity,
} from "@/domain/budget/budget.rules";
import { MONTHS, daysLeftInMonth, prevMonth, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";

/* چیپ درصد تغییر — رنگ بر اساس «خوب بودنِ» جهت تغییر، نه علامت عدد
   (هزینه کمتر = سبز، درآمد کمتر = قرمز) */
function DeltaChip({
  value,
  goodWhen,
}: {
  value: number | null;
  goodWhen: "up" | "down";
}) {
  if (value === null) return null;
  if (value === 0) return <span className="hp-delta flat">۰٪</span>;
  const up = value > 0;
  const tone = (up ? "up" : "down") === goodWhen ? "good" : "bad";
  return (
    <span className={`hp-delta ${tone}`}>
      <svg
        aria-hidden="true"
        style={{ transform: `rotate(${up ? -90 : 90}deg)` }}
      >
        <use href="#i-arrow-r" />
      </svg>
      {toFa(Math.min(Math.abs(value), 999))}٪
    </span>
  );
}

export function HomeSummaryWidget({
  onNavBudgets,
}: {
  onNavBudgets: () => void;
}) {
  const { txs, family, budgets } = useApp();
  const cur = family?.currency ?? "تومان";
  const [jy, jm, jd] = today();

  const d = useMemo(() => {
    const totals = monthTotals(txsInJalaliMonth(txs, jy, jm));
    /* مقایسه منصفانه: روز ۱ تا امروز، در برابر همان بازه از ماه گذشته */
    const [py, pm] = prevMonth(jy, jm);
    const soFar = monthTotals(txsInJalaliMonthUpToDay(txs, jy, jm, jd));
    const prev = monthTotals(txsInJalaliMonthUpToDay(txs, py, pm, jd));
    return {
      balance: totalBalance(txs),
      totals,
      dIncome: deltaPercent(soFar.income, prev.income),
      dExpense: deltaPercent(soFar.expense, prev.expense),
      cap: spendCapacity(
        budgets,
        monthCategorySpend(txs, jy, jm),
        daysLeftInMonth([jy, jm, jd]),
      ),
    };
  }, [txs, budgets, jy, jm, jd]);

  const net = d.totals.income - d.totals.expense;
  const hasDelta = d.dIncome !== null || d.dExpense !== null;
  const over = d.cap.remaining < 0;

  return (
    <section className="home-panel">
      {/* ── موجودی کل ── */}
      <div className="hp-top">
        <p className="hp-label">موجودی کل خانواده</p>
        <h2
          className="hp-balance"
          style={d.balance < 0 ? { color: "var(--danger)" } : undefined}
        >
          {formatAmount(toDisplay(d.balance, cur))}
          <span className="hp-cur">{cur}</span>
        </h2>
      </div>

      {/* ── دفتر ماه: درآمد / هزینه / مانده ── */}
      <div className="hp-ledger">
        <div className="hp-metric">
          <span className="hp-metric-label">درآمد ماه</span>
          <b className="hp-metric-value income">
            {formatAmount(toDisplay(d.totals.income, cur))}
          </b>
          <DeltaChip value={d.dIncome} goodWhen="up" />
        </div>
        <div className="hp-metric">
          <span className="hp-metric-label">هزینه ماه</span>
          <b className="hp-metric-value expense">
            {formatAmount(toDisplay(d.totals.expense, cur))}
          </b>
          <DeltaChip value={d.dExpense} goodWhen="down" />
        </div>
        <div className="hp-metric">
          <span className="hp-metric-label">مانده ماه</span>
          <b className={`hp-metric-value ${net >= 0 ? "income" : "expense"}`}>
            {net >= 0 ? "＋" : "−"}
            {formatAmount(toDisplay(net, cur))}
          </b>
        </div>
      </div>

      {hasDelta ? (
        <p className="hp-note">
          درصدها در مقایسه با همین بازه از ماه گذشته است
        </p>
      ) : null}

      {/* ── قابل خرج تا پایان ماه ── */}
      {d.cap.active ? (
        <div className="hp-cap">
          <div className="hp-cap-head">
            <span>
              {over ? "از سقف بودجه گذشته‌اید" : `قابل خرج تا پایان ${MONTHS[jm - 1]}`}
            </span>
            <span className="hp-cap-days">{toFa(d.cap.daysLeft)} روز مانده</span>
          </div>
          <b className={`hp-cap-value ${over ? "over" : ""}`}>
            {over ? "−" : ""}
            {formatAmount(toDisplay(d.cap.remaining, cur))}
            <span className="hp-cur">{cur}</span>
          </b>
          <div
            className="hp-bar"
            role="progressbar"
            aria-label="مصرف بودجه ماه"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(d.cap.percent, 100)}
          >
            <i
              className={`hp-bar-fill ${d.cap.level}`}
              style={{ width: `${Math.min(d.cap.percent, 100)}%` }}
            />
          </div>
          <div className="hp-cap-foot">
            <span>
              {over ? "سقف ماه" : "سهم هر روز"}{" "}
              <b>{formatAmount(toDisplay(over ? d.cap.cap : d.cap.perDay, cur))}</b>
            </span>
            <span>
              <b>{toFa(Math.min(d.cap.percent, 999))}٪</b> از سقف خرج شده
            </span>
          </div>
        </div>
      ) : (
        <div className="hp-cap empty">
          <p>
            برای دسته‌های هزینه سقف ماهانه تعیین کنید تا همین‌جا ببینید تا پایان ماه
            چقدر می‌توانید خرج کنید.
          </p>
          <button type="button" className="hp-cta" onClick={onNavBudgets}>
            تعیین بودجه
          </button>
        </div>
      )}
    </section>
  );
}
