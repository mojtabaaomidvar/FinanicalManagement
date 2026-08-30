/* صفحه گزارش‌ها */

import { MonthlyReportPanelWidget } from "@/widgets/monthly-report-panel";

export function ReportsPage() {
  return (
    <section className="page">
      <header className="app-header">
        <div className="header-title">
          <h1>گزارش‌ها</h1>
          <p>تحلیل مالی خانواده</p>
        </div>
      </header>
      <div className="content">
        <MonthlyReportPanelWidget />
      </div>
    </section>
  );
}
