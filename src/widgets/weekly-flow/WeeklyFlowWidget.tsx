/* ویجت جریان نقدی هفتگی — خالص هفته، ورودی/خروجی و روند ۷ روز */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card, LineChart, themeColors } from "@/shared/ui";
import { weekFlow } from "@/domain/report/report.rules";
import { today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

export function WeeklyFlowWidget() {
  const { txs, family } = useApp();
  const cur = family?.currency ?? "تومان";

  const flow = useMemo(() => weekFlow(txs, today()), [txs]);
  const C = themeColors();

  return (
    <Card title="جریان نقدی هفته">
      <div className="flow-head">
        <div className="flow-net">
          <span>خالص هفته</span>
          <b className={flow.net >= 0 ? "income" : "expense"}>
            {formatAmount(toDisplay(Math.abs(flow.net), cur))}
            <i>{cur}</i>
          </b>
        </div>
        <div className="flow-io">
          <span className="in">
            <svg style={{ transform: "rotate(-90deg)" }}>
              <use href="#i-arrow-r" />
            </svg>
            <b>
              {formatAmount(toDisplay(flow.totalIn, cur))}
              <i className="cur-tag">{cur}</i>
            </b>
          </span>
          <span className="out">
            <svg style={{ transform: "rotate(90deg)" }}>
              <use href="#i-arrow-r" />
            </svg>
            <b>
              {formatAmount(toDisplay(flow.totalOut, cur))}
              <i className="cur-tag">{cur}</i>
            </b>
          </span>
        </div>
      </div>
      <LineChart
        labels={flow.labels}
        height={150}
        series={[
          { values: flow.income, color: C.income, kind: "income" },
          { values: flow.expense, color: C.expense, kind: "expense" },
        ]}
      />
    </Card>
  );
}
