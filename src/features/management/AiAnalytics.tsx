import { useEffect, useState } from "react";
import { managementApi as api } from "./api";
import type { AnalyticsDays } from "./analytics.types";
import type { AiReport } from "./ai-analytics.types";
import { stageLabels } from "./report.labels";
const number = (value: number) => value.toLocaleString("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran",
}).format(new Date(value));

export function AiAnalytics({ days, refresh }: { days: AnalyticsDays; refresh: number }) {
  const [report, setReport] = useState<AiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true); setError(""); setReport(null); setExportStatus("");
    void api.get<AiReport>(`/state/ai-analytics?days=${days}`)
      .then(value => { if (current) setReport(value); })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : "دریافت گزارش هوش مصنوعی انجام نشد."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [days, refresh]);
  function exportReport() {
    if (!report) return;
    try {
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url; link.download = `khaneyar-ai-${days}-days.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setExportStatus("گزارش تجمیعی هوش مصنوعی برای دریافت آماده شد.");
    } catch { setExportStatus("دریافت گزارش هوش مصنوعی انجام نشد؛ دوباره تلاش کنید."); }
  }
  const totals = report?.totals;
  return <section className="mg-section" aria-labelledby="mg-ai-analytics-title">
    <div className="mg-section-heading"><h2 id="mg-ai-analytics-title">مصرف هوش مصنوعی</h2>
      <p>شمارندهٔ ساعتیِ تجمیعی در بازهٔ انتخاب‌شده؛ بدون شناسهٔ خانواده، متن درخواست یا پاسخ.</p></div>
    {loading ? <p className="mg-empty" role="status">در حال دریافت آمار هوش مصنوعی…</p>
      : error ? <p className="mg-error" role="alert">{error}</p>
        : !report?.available ? <p className="mg-empty">شمارندهٔ هوش مصنوعی روی این نسخه نصب نشده است؛ مصرف نامعلوم صفر نمایش داده نمی‌شود.</p>
          : totals && <>
            <dl className="mg-analytics-stats">
              <div><dt>فراخوانی سرویس AI</dt><dd>{number(totals.requests)}</dd></div>
              <div><dt>پاسخ معتبر</dt><dd>{number(totals.successes)}</dd></div>
              <div><dt>فراخوانی ناموفق</dt><dd>{number(totals.failures)}</dd></div>
              <div><dt>توکن ورودی اعلام‌شده</dt><dd>{totals.input_tokens === null ? <span className="mg-hint">اعلام‌نشده</span> : number(totals.input_tokens)}</dd></div>
              <div><dt>توکن خروجی اعلام‌شده</dt><dd>{totals.output_tokens === null ? <span className="mg-hint">اعلام‌نشده</span> : number(totals.output_tokens)}</dd></div>
            </dl>
            {report.first_counter ? <p className="mg-hint">اولین شمارندهٔ موجود: {date(report.first_counter)}</p>
              : <p className="mg-empty">هنوز فراخوانی‌ای در این شمارنده ثبت نشده است؛ تاریخچهٔ قبل از نصب بازسازی نمی‌شود.</p>}
            <p className="mg-hint">از {number(totals.requests)} فراخوانی، مصرف ورودی برای {number(totals.input_token_requests)} و مصرف خروجی برای {number(totals.output_token_requests)} فراخوانی اعلام شده است. جمع توکن‌ها فقط بخش اعلام‌شده را پوشش می‌دهد.</p>
            <details className="mg-analytics-daily"><summary>جزئیات فراخوانی‌های هوش مصنوعی</summary>
              <div className="mg-table-wrap"><table><thead><tr><th>مسیر استفاده</th><th>فراخوانی</th><th>پاسخ معتبر</th><th>ناموفق</th></tr></thead>
                <tbody>{report.stages?.map(row => <tr key={row.stage}><th scope="row">{stageLabels[row.stage]}</th>
                  <td>{number(row.requests)}</td><td>{number(row.successes)}</td><td>{number(row.failures)}</td></tr>)}</tbody></table></div>
            </details>
            <p className="mg-hint">هر درخواست دستیار ممکن است چند فراخوانی داشته باشد. پاسخ معتبر به معنی تأیید یا اجرای پیشنهاد نیست. خطای ارتباط ممکن است مصرف نامعلومی در سرویس داشته باشد؛ این گزارش صورتحساب یا برآورد هزینه نیست.</p>
            <button onClick={exportReport}>دریافت گزارش تجمیعی AI</button>
            {exportStatus && <p role="status">{exportStatus}</p>}
          </>}
  </section>;
}
