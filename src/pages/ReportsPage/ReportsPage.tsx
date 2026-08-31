/* صفحه گزارش‌ها */

import { MonthlyReportPanelWidget } from "@/widgets/monthly-report-panel";
import type { TxFormModel } from "@/features/transaction-form";

export function ReportsPage({ form }: { form: TxFormModel }) {
  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>گزارش‌ها</h1>
          <p>تحلیل مالی خانواده</p>
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
        </div>
      </header>
      <div className="content">
        <MonthlyReportPanelWidget />
      </div>
    </section>
  );
}
