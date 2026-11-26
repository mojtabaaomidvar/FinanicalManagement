import { useEffect, useRef, useState } from "react";
import { managementApi as api, type Role } from "./api";
import type { AnalyticsDays } from "./analytics.types";
import type { Page } from "./labels";
import { loadReportSheets } from "./report-spreadsheets";
import { downloadExcel } from "./xlsx";

export function ReportsExport({ page, role, days, changeDays }: {
  page: Page; role: Role; days: AnalyticsDays; changeDays: (days: AnalyticsDays) => void;
}) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  async function exportReports(all: boolean) {
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setMessage("");
    try {
      const bundle = await loadReportSheets(all ? "all" : page, role, days,
        path => api.get(path, request.signal), () => !request.signal.aborted);
      if (request.signal.aborted) return;
      downloadExcel(bundle.sheets, `khaneyar-${all ? "all-reports" : page}-${days}-days.xlsx`);
      setMessage(bundle.partial ? "فایل اکسل آماده شد؛ بعضی گزارش‌ها دریافت نشدند و در برگهٔ راهنما مشخص‌اند."
        : "فایل اکسل کامل، همراه ردیف‌های صفر و بدون داده، آمادهٔ دریافت شد.");
    } catch (error) {
      if (!request.signal.aborted) setMessage(error instanceof Error && error.message ? error.message : "دریافت گزارش اکسل انجام نشد؛ دوباره تلاش کنید.");
    } finally { if (!request.signal.aborted) setBusy(false); }
  }
  return <section className="mg-section mg-export" aria-label="خروجی اکسل گزارش‌ها">
    <div className="mg-filter"><label><span id="mg-export-days">بازهٔ آماری فایل اکسل</span>
      <select aria-labelledby="mg-export-days" disabled={busy} value={days} onChange={event => changeDays(Number(event.target.value) as AnalyticsDays)}>
        <option value={7}>۷ روز اخیر</option><option value={30}>۳۰ روز اخیر</option><option value={90}>۹۰ روز اخیر</option>
      </select></label><button type="button" disabled={busy} onClick={() => void exportReports(false)}>دریافت اکسل این بخش</button>
      <button type="button" disabled={busy} onClick={() => void exportReports(true)}>دریافت اکسل همهٔ گزارش‌ها</button>
      {busy && <button type="button" onClick={() => { controller.current?.abort(); setBusy(false); setMessage("دریافت گزارش اکسل لغو شد."); }}>لغو دریافت اکسل</button>}
    </div>
    <p className="mg-hint">فایل واقعی xlsx شامل همهٔ ردیف‌ها و همهٔ صفحات قابل دریافت فهرست‌هاست؛ فیلتر جست‌وجوی صفحه، ردیفی را از خروجی حذف نمی‌کند. صفر با دادهٔ اندازه‌گیری‌نشده متفاوت است. گزارش‌ها مطابق دسترسی همین نقش خوانده می‌شوند.</p>
    {busy && <p role="status">در حال آماده‌سازی گزارش اکسل…</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
