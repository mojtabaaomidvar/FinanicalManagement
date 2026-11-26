import { useEffect, useState, type ReactNode } from "react";
import { managementApi as api, type Overview } from "./api";
import { InstalledVersions } from "./InstalledVersions";
import type { AnalyticsDays, ProductReport } from "./analytics.types";
import type { Page } from "./labels";
import { serviceLabels, stateLabels } from "./labels";
import { DailyChart, formatCount, MembershipChart, ModuleChart } from "./DashboardCharts";
import { resourcePercent } from "./dashboard.rules";
import "./dashboard.css";

function useDashboardResource<T>(path: string, refresh: number) {
  const [state, setState] = useState<{ path: string; refresh: number; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let current = true;
    void api.get<T>(path).then(data => { if (current) setState({ path, refresh, data }); })
      .catch((error: unknown) => { if (current) setState({ path, refresh, error: error instanceof Error ? error.message : "دریافت اطلاعات داشبورد انجام نشد." }); });
    return () => { current = false; };
  }, [path, refresh]);
  return state?.path === path && state.refresh === refresh ? state : null;
}

function PendingOrError({ error, children }: { error?: string; children: ReactNode }) {
  return error ? <div className="mg-state mg-error" role="alert"><strong>دریافت این بخش کامل نشد</strong><p>{error}</p>
    <p>برای تلاش دوباره، «بررسی دوباره» را بزنید.</p></div>
    : <div className="mg-state" role="status">{children}</div>;
}

function Stat({ label, value, note }: { label: string; value: number | null; note: string }) {
  return <div><dt>{label}</dt><dd>{value === null ? <span className="mg-hint">اندازه‌گیری‌نشده</span> : formatCount(value)}</dd><span className="mg-hint">{note}</span></div>;
}

function HostSnapshot({ data, navigate }: { data: Overview; navigate: (page: Page) => void }) {
  const ready = data.api === "available" && data.database === "available";
  const date = new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(data.checked_at * 1000));
  return <section className="mg-dash-host mg-section"><div className="mg-dash-heading"><h2>وضعیت فعلی سرور</h2>
    <span className={`mg-badge ${ready ? "mg-good" : "mg-bad"}`}>{ready ? "در دسترس" : "نیازمند بررسی"}</span></div>
    <p className="mg-hint">آخرین بررسی: {date}</p>
    <dl className="mg-dash-host-facts"><InstalledVersions data={data} />
      <div><dt>زمان روشن‌بودن</dt><dd>{formatCount(Math.floor(data.uptime_seconds / 86400))} روز</dd></div></dl>
    <dl className="mg-dash-load"><dt>بار پردازنده</dt><dd>{data.cpu_load.toLocaleString("fa-IR", { maximumFractionDigits: 2 })}</dd></dl>
    <p className="mg-hint">میانگین یک دقیقه، در کنار {formatCount(data.cpu_cores)} هسته؛ این عدد درصد مصرف نیست.</p>
    <div className="mg-dash-host-resources">{[
      { label: "حافظهٔ رم", used: data.memory_used, total: data.memory_total },
      { label: "فضای دیسک", used: data.disk_used, total: data.disk_total },
    ].map(item => {
      const percent = resourcePercent(item.used, item.total);
      return <div key={item.label}><div><span>{item.label}</span><strong>{percent === null ? "—" : percent.toLocaleString("fa-IR") + "٪"}</strong></div>
        {percent !== null ? <meter min={0} max={100} value={percent} aria-label={item.label} /> : <p className="mg-hint">مقدار کل منبع مشخص نیست.</p>}</div>;
    })}</div>
    <dl className="mg-dash-services">{[
      { id: "api", state: data.api }, { id: "db", state: data.database },
      { id: "nginx", state: data.services.find(service => service.id === "nginx")?.state ?? "unknown" },
    ].map(service => <div key={service.id}><dt>{serviceLabels[service.id]}</dt><dd>
      <span className={service.state === "available" || service.state === "active" ? "mg-dash-health-good" : "mg-error"}>
        {stateLabels[service.state] ?? stateLabels.unknown}</span></dd></div>)}</dl>
    <button onClick={() => navigate("overview")}>جزئیات سلامت و منابع</button>
    <p className="mg-hint mg-dash-host-note">منابع، تصویر همین لحظه‌اند؛ تاریخچهٔ مصرف سرور هنوز ذخیره نمی‌شود.</p>
  </section>;
}

export function ManagementDashboard({ refresh, navigate, days, changeDays }: { refresh: number; navigate: (page: Page) => void; days: AnalyticsDays; changeDays: (days: AnalyticsDays) => void }) {
  const host = useDashboardResource<Overview>("/state/overview", refresh);
  const product = useDashboardResource<ProductReport>(`/state/analytics?days=${days}`, refresh);
  const report = product?.data;
  return <div className="mg-dashboard"><div className="mg-dash-toolbar"><p>رشد خانه‌یار، استفاده از بخش‌ها و سلامت سرویس‌ها در یک نگاه.</p>
    <label><span id="mg-dashboard-period">بازهٔ داشبورد</span><select aria-labelledby="mg-dashboard-period" value={days} onChange={event => changeDays(Number(event.target.value) as AnalyticsDays)}>
      <option value={7}>۷ روز اخیر</option><option value={30}>۳۰ روز اخیر</option><option value={90}>۹۰ روز اخیر</option>
    </select></label></div>
    <div className="mg-dash-layout"><div className="mg-dash-product">
      {!report ? <PendingOrError error={product?.error}>در حال دریافت آمار داشبورد…</PendingOrError> : <>
        <dl className="mg-dash-kpis">
          <Stat label="خانواده‌های عضو" value={report.snapshot.families} note="تعداد فعلی خانواده‌های موجود" />
          <Stat label="حساب‌های ثبت‌نام‌کامل" value={report.snapshot.registered_accounts} note="بدون پروفایل‌های فاقد حساب" />
          <Stat label="درخواست‌های موفق" value={report.usage?.requests ?? null} note="در بازهٔ انتخاب‌شده" />
          <Stat label="بازشدن بخش‌ها" value={report.usage?.opens ?? null} note="در بازهٔ انتخاب‌شده" />
        </dl>
        <div className="mg-dash-trends" key={report.checked_at + days}>
          <DailyChart title="رشد خانواده و ثبت‌نام" points={report.daily} fields={[
            { key: "families_created", label: "خانوادهٔ جدید" }, { key: "registrations_completed", label: "تکمیل ثبت‌نام" },
          ]} />
          <DailyChart title="روند استفاده" points={report.daily} fields={[
            { key: "requests", label: "درخواست موفق" }, { key: "opens", label: "بازشدن بخش" }, { key: "errors", label: "خطای ورود و ثبت‌نام" },
          ]} />
        </div>
        <div className="mg-dash-breakdown"><ModuleChart report={report} /><MembershipChart snapshot={report.snapshot} /></div>
        <div className="mg-dash-bottom"><p className="mg-hint">جمع‌های بی‌نام، روزانه به وقت تهران. آمار امروز تا زمان آخرین بررسی است؛ موارد حذف‌شده در روند رشد نیستند.</p>
          <button onClick={() => navigate("analytics")}>گزارش کامل و دریافت آمار</button></div>
        <p className="mg-hint">زمان گزارش: {new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(report.checked_at))}</p>
      </>}
    </div><aside className="mg-dash-side" aria-label="سلامت سرور">
      {host?.data ? <HostSnapshot data={host.data} navigate={navigate} /> : <PendingOrError error={host?.error}>در حال بررسی سلامت سرور…</PendingOrError>}
    </aside></div>
  </div>;
}
