/* صفحه داشبورد */

import { useMemo } from "react";
import { DashboardSummaryWidget } from "@/widgets/dashboard-summary";
import { SmsImportFeature } from "@/features/sms-import";
import { formatWeekday, today } from "@/shared/lib/jalali";
import type { TxFormModel } from "@/features/transaction-form";

export function DashboardPage({
  form,
  onImported,
  onNavTransactions,
}: {
  form: TxFormModel;
  onImported: () => void | Promise<void>;
  onNavTransactions: () => void;
}) {
  const headerDate = useMemo(() => formatWeekday(today()), []);

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>خانه یار</h1>
          <p>{headerDate}</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn add-btn"
            aria-label="افزودن تراکنش"
            onClick={form.openNew}
          >
            <svg>
              <use href="#i-plus" />
            </svg>
          </button>
          <SmsImportFeature onImported={onImported} />
        </div>
      </header>

      <div className="content">
        <DashboardSummaryWidget form={form} onNavTransactions={onNavTransactions} />
      </div>
    </section>
  );
}
