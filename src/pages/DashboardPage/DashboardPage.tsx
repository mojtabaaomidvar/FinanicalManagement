/* صفحه خانه — سلام و اعلان، جستجو، پنل خلاصه ماه،
   هزینه‌های ماه، آخرین تراکنش‌ها و نوارهای هفته/اعضا/بودجه

   ثبت تراکنش فقط از راه FAB «+» انجام می‌شود؛ ردیف میان‌بُر پیشین
   (widgets/quick-actions) حذف شد و «ثبت از پیامک» به شیت تراکنش منتقل شد. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { HomeSummaryWidget } from "@/widgets/home-summary";
import { MonthExpensesWidget } from "@/widgets/month-expenses";
import { RecentTxWidget } from "@/widgets/recent-tx";
import { WeeklyFlowWidget } from "@/widgets/weekly-flow";
import { MemberSpendWidget } from "@/widgets/member-spend";
import { BudgetCirclesWidget } from "@/widgets/budget-circles";
import { Modal } from "@/shared/ui";
import { budgetStatus, monthCategorySpend } from "@/domain/budget/budget.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { formatWeekday, today, addDays, cmp, formatLong, type JDate } from "@/shared/lib/jalali";
import type { TxFormModel } from "@/features/transaction-form";

export function DashboardPage({
  form,
  onNavTransactions,
  onNavBudgets,
  onOpenFilters,
  onSearch,
}: {
  form: TxFormModel;
  onNavTransactions: () => void;
  onNavBudgets: () => void;
  onOpenFilters: () => void;
  onSearch: (q: string) => void;
}) {
  const { member, events, budgets, txs, customCategories } = useApp();
  const headerDate = useMemo(() => formatWeekday(today()), []);
  const [q, setQ] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);

  /* اعلان‌ها: رویدادهای ۳۰ روز آینده + هشدار بودجه‌ها */
  const notifs = useMemo(() => {
    const items: { icon: string; title: string; sub: string; danger?: boolean }[] = [];
    const now = today();
    const in30 = addDays(now, 30);
    for (const e of events) {
      const [, m, d] = e.date.split("-").map(Number);
      /* سال گذشته → امسال (تولد تکرارشونده) */
      const thisYear: JDate = [now[0], m, d];
      const target: JDate = cmp(thisYear, now) < 0 ? [now[0] + 1, m, d] : thisYear;
      if (cmp(target, in30) <= 0) {
        items.push({
          icon: "i-bell",
          title: e.title,
          sub: `${formatLong(target)} · ${cmp(target, now) === 0 ? "امروز!" : "در راه است"}`,
        });
      }
    }
    const [jy, jm] = today();
    const spend = monthCategorySpend(txs, jy, jm);
    const resolve = buildCategoryResolver(customCategories);
    for (const b of budgets) {
      const spent = spend.get(b.category) ?? 0;
      const st = budgetStatus(b.amount, spent);
      if (st.level === "over") {
        items.push({
          icon: "i-wallet",
          title: `بودجه ${resolve(b.category).name} تمام شد`,
          sub: "مصرف از سقف بودجه ماه گذشته است",
          danger: true,
        });
      } else if (st.level === "warn") {
        items.push({
          icon: "i-wallet",
          title: `بودجه ${resolve(b.category).name} نزدیک سقف`,
          sub: "بیش از ۸۰٪ بودجه ماه مصرف شده",
        });
      }
    }
    return items;
  }, [events, budgets, txs, customCategories]);

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>{member ? `سلام، ${member.name}` : "خانه یار"}</h1>
          <p>{headerDate}</p>
        </div>
        <div className="header-actions">
          {/* زنگ اعلان */}
          <button
            className="icon-btn notif-btn"
            aria-label="اعلان‌ها"
            onClick={() => setNotifOpen(true)}
          >
            <svg>
              <use href="#i-bell" />
            </svg>
            {notifs.length ? (
              <span className="notif-badge">{notifs.length}</span>
            ) : null}
          </button>
        </div>
      </header>

      {/* نوار جستجوی تراکنش‌ها + فیلتر */}
      <div className="home-search">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch(q.trim());
          }}
        >
          <svg className="hs-icon">
            <use href="#i-search" />
          </svg>
          <input
            type="search"
            placeholder="جستجو در تراکنش‌ها…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>
        <button
          type="button"
          className="icon-btn hs-filter"
          aria-label="فیلتر تراکنش‌ها"
          onClick={onOpenFilters}
        >
          <svg>
            <use href="#i-filter" />
          </svg>
        </button>
      </div>

      <div className="content home-content">
        <HomeSummaryWidget onNavBudgets={onNavBudgets} />
        <MonthExpensesWidget />
        <RecentTxWidget form={form} onNavTransactions={onNavTransactions} />
        <WeeklyFlowWidget />
        <MemberSpendWidget />
        <BudgetCirclesWidget onManage={onNavBudgets} />
      </div>

      {/* مرکز اعلان‌ها */}
      <Modal open={notifOpen} onClose={() => setNotifOpen(false)} title="اعلان‌ها">
        {notifs.length ? (
          <div className="notif-list">
            {notifs.map((n, i) => (
              <div className={`notif-item ${n.danger ? "danger" : ""}`} key={i}>
                <span className="notif-ico">
                  <svg>
                    <use href={`#${n.icon}`} />
                  </svg>
                </span>
                <div>
                  <b>{n.title}</b>
                  <p>{n.sub}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="modal-sub">اعلان جدیدی نیست — همه‌چیز مرتب است ✨</p>
        )}
      </Modal>
    </section>
  );
}
