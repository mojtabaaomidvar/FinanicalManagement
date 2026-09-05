/* ویجت سهم اعضا از هزینه‌های ماه — نوار افقی سبک، ۴ نفر اول + بقیه */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { memberExpenseShare } from "@/domain/report/report.rules";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { MONTHS, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";

const TOP = 4;

interface Row {
  key: string;
  name: string;
  avatar: string | null;
  amount: number;
  pct: number;
  rest?: boolean;
}

export function MemberSpendWidget() {
  const { txs, members, family } = useApp();
  const cur = family?.currency ?? "تومان";
  const [jy, jm] = today();

  const { rows, count } = useMemo(() => {
    const share = memberExpenseShare(txsInJalaliMonth(txs, jy, jm));
    const total = share.reduce((s, x) => s + x.amount, 0);
    const pctOf = (v: number) => (total ? Math.round((v / total) * 100) : 0);
    const list: Row[] = share.slice(0, TOP).map((x) => {
      const m = members.find((mm) => mm.id === x.memberId);
      return {
        key: x.memberId,
        name: m?.name ?? "عضو حذف‌شده",
        avatar: m?.avatarUrl ?? null,
        amount: x.amount,
        pct: pctOf(x.amount),
      };
    });
    const rest = share.slice(TOP).reduce((s, x) => s + x.amount, 0);
    if (rest > 0) {
      list.push({
        key: "__rest",
        name: "بقیه اعضا",
        avatar: null,
        amount: rest,
        pct: pctOf(rest),
        rest: true,
      });
    }
    return { rows: list, count: share.length };
  }, [txs, members, jy, jm]);

  /* با یک نفر، سهم‌بندی معنا ندارد */
  if (count < 2) return null;

  return (
    <section className="strip">
      <div className="strip-head">
        <h3 className="strip-title">خرج اعضا در {MONTHS[jm - 1]}</h3>
        <span className="strip-hint">{toFa(count)} نفر</span>
      </div>

      <div className="mspend">
        {rows.map((r) => (
          <div className="mspend-row" key={r.key}>
            <span className="mspend-av">
              {r.avatar ? (
                <img src={r.avatar} alt="" />
              ) : r.rest ? (
                <svg>
                  <use href="#i-users" />
                </svg>
              ) : (
                r.name.slice(0, 1)
              )}
            </span>
            <span className="mspend-name">{r.name}</span>
            <span className="mspend-bar">
              <i
                className={r.rest ? "rest" : ""}
                style={{ width: `${Math.max(r.pct, 3)}%` }}
              />
            </span>
            <b className="mspend-amt">
              {formatAmount(toDisplay(r.amount, cur))}
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}
