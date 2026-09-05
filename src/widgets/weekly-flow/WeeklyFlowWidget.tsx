/* ویجت جریان هفته — نوار فشرده: خالص هفته + ۷ ستون کوچک ورودی/خروجی */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { weekFlow } from "@/domain/report/report.rules";
import { today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

export function WeeklyFlowWidget() {
  const { txs, family } = useApp();
  const cur = family?.currency ?? "تومان";

  const flow = useMemo(() => weekFlow(txs, today()), [txs]);

  /* مقیاس ستون‌ها نسبت به بزرگ‌ترین رقم هفته؛ صفر = خط نازک */
  const max = Math.max(...flow.income, ...flow.expense, 1);
  const h = (v: number) => `${v > 0 ? Math.max((v / max) * 100, 10) : 3}%`;

  return (
    <section className="strip">
      <div className="strip-head">
        <h3 className="strip-title">جریان هفت روز گذشته</h3>
        <span className={`strip-net ${flow.net >= 0 ? "income" : "expense"}`}>
          {flow.net >= 0 ? "＋" : "−"}
          {formatAmount(toDisplay(flow.net, cur))}
          <i>{cur}</i>
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
