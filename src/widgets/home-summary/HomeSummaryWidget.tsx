import { CurrencyUnit } from "@/shared/ui/CurrencyUnit";
/* ویجت پنل خلاصه خانه — موجودی کل، دفتر ماه با مقایسه ماه گذشته،
   و متر «قابل خرج تا پایان ماه» بر پایه سقف بودجه‌ها */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import {
  deltaPercent,
  monthTotals,
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
import { formatAmount, formatSignedAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import { FitText } from "@/shared/ui";
import { compareMoney, subtractMoney } from "@/shared/lib/money";
import { useWalletBalances } from "@/features/accounts/model/useWalletBalances";

/* چیپ درصد تغییر — رنگ بر اساس «خوب بودن» جهت تغییر، نه علامت عدد
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
  const { txs, accounts, cur, budgets } = useApp();
  const walletBalances = useWalletBalances(accounts);
  const balance = walletBalances.summary.balance;
  const [jy, jm, jd] = today();

  const d = useMemo(() => {
    const totals = monthTotals(txsInJalaliMonth(txs, jy, jm));
    /* مقایسه منصفانه: روز ۱ تا امروز، در برابر همان بازه از ماه گذشته */
    const [py, pm] = prevMonth(jy, jm);
    const soFar = monthTotals(txsInJalaliMonthUpToDay(txs, jy, jm, jd));
    const prev = monthTotals(txsInJalaliMonthUpToDay(txs, py, pm, jd));
    return {
      totals,
      dIncome: deltaPercent(soFar.income, prev.income),
      dExpense: deltaPercent(soFar.expense, prev.expense),
      cap: spendCapacity(
        budgets,
        monthCategorySpend(txs, jy, jm),
        daysLeftInMonth([jy, jm, jd]),
      ),
    };
  }, [txs, accounts, budgets, jy, jm, jd]);

  const net = subtractMoney(d.totals.income, d.totals.expense);
  const hasDelta = d.dIncome !== null || d.dExpense !== null;
  const over = compareMoney(d.cap.remaining, "0") < 0;

  return (
    <section className="home-panel">
      {/* ── موجودی کل ── */}
      <div className="hp-top">
        <p className="hp-label">موجودی نقد حساب‌ها</p>
        <h2
          className="hp-balance"
          style={balance !== null && compareMoney(balance, "0") < 0 ? { color: "var(--danger)" } : undefined}
        >
          <FitText>
            {balance !== null ? <>{formatSignedAmount(toDisplay(balance, cur))}
              <CurrencyUnit className="hp-cur" /></>
              : walletBalances.summary.status === "error" ? "موجودی دریافت نشد" : "در حال دریافت موجودی…"}
          </FitText>
        </h2>
        {walletBalances.summary.status === "error" ? <button type="button" className="btn-secondary" onClick={walletBalances.refresh}>تلاش دوباره</button> : null}
        {walletBalances.summary.reconciled ? <p className="hp-note">موجودی شامل اصلاح‌های مغایرت‌گیری است؛ گزارش ماه فقط از تراکنش‌ها محاسبه می‌شود.</p> : null}
      </div>

      {/* ── دفتر ماه: درآمد / هزینه / مانده ── */}
      <div className="hp-ledger">
        <div className="hp-metric">
          <span className="hp-metric-label">درآمد ماه</span>
          <b className="hp-metric-value income">
            <FitText>{formatAmount(toDisplay(d.totals.income, cur))}</FitText>
          </b>
          <DeltaChip value={d.dIncome} goodWhen="up" />
        </div>
        <div className="hp-metric">
          <span className="hp-metric-label">هزینه ماه</span>
          <b className="hp-metric-value expense">
            <FitText>{formatAmount(toDisplay(d.totals.expense, cur))}</FitText>
          </b>
          <DeltaChip value={d.dExpense} goodWhen="down" />
        </div>
        <div className="hp-metric">
          <span className="hp-metric-label">مانده ماه</span>
          <b className={`hp-metric-value ${compareMoney(net, "0") >= 0 ? "income" : "expense"}`}>
            <FitText>{formatSignedAmount(toDisplay(net, cur))}</FitText>
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
              {over
                ? "از بودجهٔ دسته‌ها گذشته‌اید"
                : `بودجهٔ دسته‌ها تا پایان ${MONTHS[jm - 1]}`}
            </span>
            <span className="hp-cap-days">
              {toFa(d.cap.daysLeft)} روز مانده
            </span>
          </div>
          <b className={`hp-cap-value ${over ? "over" : ""}`}>
            <FitText>
              {over ? "−" : ""}
              {formatAmount(toDisplay(d.cap.remaining, cur))}
              <CurrencyUnit className="hp-cur" />
            </FitText>
          </b>
          <div
            className="hp-bar"
            role="progressbar"
            aria-label="مصرف بودجهٔ دسته‌ها"
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
              {over ? "بودجه ماه" : "سهم هر روز"}{" "}
              <b>
                {formatAmount(toDisplay(over ? d.cap.cap : d.cap.perDay, cur))}
              </b>
            </span>
            <span>
              <b>{toFa(Math.min(d.cap.percent, 999))}٪</b> از بودجهٔ دسته‌ها مصرف شده
            </span>
          </div>
          {compareMoney(d.cap.unbudgetedSpent, "0") > 0 ? <p className="hp-note hp-unbudgeted">
            هزینهٔ بدون بودجه: {formatAmount(toDisplay(d.cap.unbudgetedSpent, cur))} <CurrencyUnit />
          </p> : null}
        </div>
      ) : (
        <div className="hp-cap empty">
          <p>
            برای دسته‌های هزینه سقف ماهانه تعیین کنید تا همین‌جا ببینید تا پایان
            ماه چقدر می‌توانید خرج کنید.
          </p>
          <button type="button" className="hp-cta" onClick={onNavBudgets}>
            تعیین بودجه
          </button>
        </div>
      )}
    </section>
  );
}
