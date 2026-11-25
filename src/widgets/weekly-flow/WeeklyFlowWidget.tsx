import { CurrencyUnit } from "@/shared/ui/CurrencyUnit";
/* ویجت جریان هفته — نوار فشرده: خالص هفته + ۷ ستون کوچک ورودی/خروجی */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { weekFlow } from "@/domain/report/report.rules";
import { today } from "@/shared/lib/jalali";
import { formatAmount, formatSignedAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { compareMoney, moneyRatio } from "@/shared/lib/money";

export function WeeklyFlowWidget() {
  const { txs, cur } = useApp();

  const flow = useMemo(() => weekFlow(txs, today()), [txs]);

  /* مقیاس ستون‌ها نسبت به بزرگ‌ترین رقم هفته؛ صفر = خط نازک */
  const max = [...flow.income, ...flow.expense].reduce((max, v) => compareMoney(v, max) > 0 ? v : max, "1");
  const h = (v: string) => `${compareMoney(v, "0") > 0 ? Math.max(moneyRatio(v, max) * 100, 10) : 3}%`;

  return (
    <section className="strip">
      <div className="strip-head">
        <h3 className="strip-title">جریان هفت روز گذشته</h3>
        <span className={`strip-net ${compareMoney(flow.net, "0") >= 0 ? "income" : "expense"}`}>
          {formatSignedAmount(toDisplay(flow.net, cur))}
          <CurrencyUnit />
        </span>
      </div>

      <div className="week-bars">
        {flow.labels.map((lb, i) => (
          <div className="wb-day" key={i}>
            <span className="wb-col">
              <i className="wb-in" style={{ height: h(flow.income[i]) }} />
              <i className="wb-out" style={{ height: h(flow.expense[i]) }} />
            </span>
            <span className="wb-label">{lb}</span>
          </div>
        ))}
      </div>

      <div className="strip-foot">
        <span>
          <i className="mini-dot income" />
          ورودی <b>{formatAmount(toDisplay(flow.totalIn, cur))}</b>
        </span>
        <span>
          <i className="mini-dot expense" />
          خروجی <b>{formatAmount(toDisplay(flow.totalOut, cur))}</b>
        </span>
      </div>
    </section>
  );
}
