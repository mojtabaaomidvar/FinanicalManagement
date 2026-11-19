/* صفحه خانه — سلام و اعلان، جستجو، پنل خلاصه ماه،
   هزینه‌های ماه، آخرین تراکنش‌ها و نوارهای هفته/اعضا/بودجه

   پس از بازنشستگی تب‌بار و FAB، ثبت تراکنش از دکمه‌ی «+» در هدر همین
   صفحه (یا دکمه‌ی پهن هاب) باز می‌شود؛ ردیف میان‌بُر پیشین
   (widgets/quick-actions) حذف شد و «ثبت از پیامک» به شیت تراکنش منتقل شد. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { HomeSummaryWidget } from "@/widgets/home-summary";
import { DueRecurringWidget } from "@/widgets/due-recurring";
import { MonthExpensesWidget } from "@/widgets/month-expenses";
import { RecentTxWidget } from "@/widgets/recent-tx";
import { WeeklyFlowWidget } from "@/widgets/weekly-flow";
import { MemberSpendWidget } from "@/widgets/member-spend";
import { BudgetCirclesWidget } from "@/widgets/budget-circles";
import { formatWeekday, today } from "@/shared/lib/jalali";
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
  const { member } = useApp();
  const headerDate = useMemo(() => formatWeekday(today()), []);
  const [q, setQ] = useState("");
  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>{member ? `سلام، ${member.name}` : "خانه یار"}</h1>
          <p>{headerDate}</p>
        </div>
        <div className="header-actions">
          {/* افزودن تراکنش — جانشین FAB پیشین پس از بازنشستگی تب‌بار */}
          <button
            className="icon-btn"
            aria-label="افزودن تراکنش"
            onClick={() => form.openNew()}
          >
            <svg>
              <use href="#i-plus" />
            </svg>
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
        <DueRecurringWidget form={form} />
        <MonthExpensesWidget />
        <RecentTxWidget form={form} onNavTransactions={onNavTransactions} />
        <WeeklyFlowWidget />
        <MemberSpendWidget />
        <BudgetCirclesWidget onManage={onNavBudgets} />
      </div>

    </section>
  );
}
