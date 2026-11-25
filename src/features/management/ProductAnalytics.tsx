import { useEffect, useState, type ReactNode } from "react";
import { managementApi as api } from "./api";
import type { AnalyticsDays, AnalyticsModule, AnalyticsPoint, ModuleCounts, ProductReport } from "./analytics.types";

const moduleLabels: Record<AnalyticsModule, string> = {
  dashboard: "داشبورد مالی", transactions: "تراکنش‌ها", accounts: "کیف پول‌ها", budgets: "بودجه‌ها",
  bills: "قبوض و شارژ", reports: "گزارش‌ها", calendar: "تقویم و مناسبت‌ها", shopping: "لیست خرید",
  inventory: "انبار خانه", tasks: "کارهای خانه", documents: "اسناد خانه", meals: "برنامهٔ غذایی",
  equipment: "وسایل خانه", vehicles: "خودرو", goals: "اهداف و آرزوها", activities: "برنامه‌های خانوادگی",
  children: "فرزندان", pets: "حیوانات خانگی", market: "بازار", settings: "تنظیمات", notifications: "اعلان‌ها",
};
const number = (value: number) => value.toLocaleString("fa-IR");
const day = (value: string) => new Intl.DateTimeFormat("fa-IR", { month: "short", day: "numeric", timeZone: "Asia/Tehran" }).format(new Date(value + "T12:00:00+03:30"));
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(value));
const requests = (row: ModuleCounts) => row.creates + row.updates + row.completes + row.deletes;
const recordLabels: Record<keyof ProductReport["record_inventory"], string> = {
  wallets: "کیف پول و حساب", budget_limits: "سقف بودجهٔ ثبت‌شده", bills: "قبض ثبت‌شده", inventory_items: "قلم انبار",
  shopping_items: "قلم خرید", meal_dishes: "غذای ثبت‌شده", meal_entries: "وعدهٔ برنامه‌ریزی‌شده", equipment: "وسیلهٔ خانه",
  vehicles: "خودروی ثبت‌شده", maintenance_records: "سابقهٔ سرویس", calendar_events: "رویداد تقویم",
  goals: "هدف و آرزو", pets: "پروفایل حیوان خانگی", bank_messages: "پیامک بانکی دریافت‌شده",
};

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="mg-section"><div className="mg-section-heading"><h2>{title}</h2>{note && <p>{note}</p>}</div>{children}</section>;
}
function Metric({ label, value }: { label: string; value: number | null | undefined }) {
  return <div><dt>{label}</dt><dd>{typeof value === "number" ? number(value) : <span className="mg-hint">اندازه‌گیری‌نشده</span>}</dd></div>;
}

function Trend({ title, points, field }: { title: string; points: AnalyticsPoint[]; field: "families_created" | "requests" }) {
  const missing = points.some(point => point[field] === null);
  const values = points.map(point => point[field] ?? 0);
  const largest = Math.max(1, ...values);
  const line = values.map((value, index) => `${740 - index / (values.length - 1) * 720},${124 - value / largest * 104}`).join(" ");
  return <figure className="mg-analytics-chart"><figcaption><h3>{title}</h3><strong>{missing ? "—" : number(values.reduce((sum, value) => sum + value, 0))}</strong></figcaption>
    {missing ? <p className="mg-empty">شمارندهٔ این نمودار در دسترس نیست.</p> : <>
      <svg viewBox="0 0 760 140" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line x1="20" x2="740" y1="124" y2="124" className="mg-chart-rule" />
        <polyline points={line} fill="none" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
      </svg><div className="mg-chart-dates"><span>{day(points[0].day)}</span><span>{day(points[points.length - 1].day)}</span></div>
    </>}
  </figure>;
}

function Report({ report }: { report: ProductReport }) {
  const [showAll, setShowAll] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const snapshot = report.snapshot;
  const ranked = [...(report.modules ?? [])].sort((a, b) => requests(b) - requests(a) || b.opens - a.opens || a.module.localeCompare(b.module));
  const visible = showAll ? ranked : ranked.filter(row => row.opens || requests(row)).slice(0, 8);
  const busiest = ranked.find(row => requests(row) > 0);
  const popular = [...ranked].sort((a, b) => b.opens - a.opens).find(row => row.opens > 0);
  function exportReport() {
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `khaneyar-product-${report.days}-days.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setExportStatus("گزارش تجمیعی برای دریافت آماده شد.");
    } catch { setExportStatus("دریافت فایل گزارش انجام نشد؛ دوباره تلاش کنید."); }
  }
  return <>
    <div className="mg-analytics-intro"><p>آمار کلی برای تصمیم‌گیری دربارهٔ توسعهٔ خانه‌یار؛ بدون نام، شماره، شناسهٔ خانواده یا محتوای خصوصی.</p>
      <button onClick={exportReport}>دریافت گزارش تجمیعی</button></div>
    {exportStatus && <p className="mg-notice" role="status">{exportStatus}</p>}
    <dl className="mg-facts mg-analytics-headline">
      <Metric label="خانوادهٔ ثبت‌شده تا این لحظه" value={snapshot.families} />
      <Metric label="حساب با ثبت‌نام کامل" value={snapshot.registered_accounts} />
      <Metric label="درخواست موفق ثبت‌شده در بازه" value={report.usage?.requests} />
      <Metric label="بازشدن بخش‌ها در بازه" value={report.usage?.opens} />
    </dl>
    <Section title="رشد و فعالیت در بازه" note="هر نقطه یک روز به وقت تهران است. آمار امروز تا زمان آخرین بررسی محاسبه می‌شود.">
      <div className="mg-analytics-trends"><Trend title="خانواده‌های جدیدِ موجود" points={report.daily} field="families_created" />
        <Trend title="درخواست‌های موفق ثبت‌شده" points={report.daily} field="requests" /></div>
      <dl className="mg-analytics-stats">
        <Metric label="تکمیل ثبت‌نام با تاریخ ثبت‌شده" value={report.daily.reduce((sum, point) => sum + point.registrations_completed, 0)} />
        <Metric label="حساب با ورود موفق در بازه" value={snapshot.accounts_with_login} />
        <Metric label="خانواده با ورود موفق در بازه" value={snapshot.families_with_login} />
      </dl>
      <details className="mg-analytics-daily"><summary>نمایش جدول روزانه</summary><div className="mg-table-wrap"><table><thead><tr>
        <th>روز</th><th>خانوادهٔ جدید</th><th>تکمیل ثبت‌نام</th><th>بازشدن</th><th>درخواست موفق</th><th>خطای ورود و ثبت‌نام</th>
      </tr></thead><tbody>{report.daily.map(point => <tr key={point.day}><td>{day(point.day)}</td>
        {[point.families_created, point.registrations_completed, point.opens, point.requests, point.errors].map((value, index) => <td key={index}>{value === null ? "—" : number(value)}</td>)}
      </tr>)}</tbody></table></div></details>
    </Section>
    <Section title="وضعیت حساب‌ها و ثبت‌نام" note="این عددها وضعیت فعلی سامانه‌اند. پروفایل معرفی‌شده یا مدیریت‌شده، حساب مستقل با ثبت‌نام کامل محسوب نمی‌شود.">
      <dl className="mg-analytics-stats">
        <Metric label="خانواده دارای حساب ثبت‌نام کامل" value={snapshot.families_with_accounts} />
        <Metric label="مجموع پروفایل‌ها" value={snapshot.profiles} />
        <Metric label="حساب با عضویت فعال" value={snapshot.active_accounts} />
        <Metric label="حساب در انتظار تأیید عضویت" value={snapshot.pending_accounts} />
        <Metric label="حساب با عضویت غیرفعال" value={snapshot.inactive_accounts} />
        <Metric label="معرفی‌شده؛ ثبت‌نام ناتمام" value={snapshot.introduced_profiles} />
        <Metric label="پروفایل بدون حساب مستقل" value={snapshot.managed_profiles} />
        <Metric label="حساب بدون سابقهٔ ثبت‌شدهٔ ورود" value={snapshot.accounts_without_login_history} />
        <Metric label="حساب بدون تاریخ ثبت‌شدهٔ تکمیل ثبت‌نام" value={snapshot.accounts_without_registration_history} />
      </dl>
    </Section>
    <Section title="استفاده از بخش‌های نرم‌افزار" note="درخواست موفق، تعداد درخواست‌های پذیرفته‌شدهٔ شمارش‌شده است؛ یک درخواست می‌تواند چند رکورد را تغییر دهد و تکرار درخواست هم شمرده می‌شود.">
      {!report.measurement.usage_available ? <p className="mg-empty">شمارندهٔ استفاده در این نسخه در دسترس نیست؛ عدد صفر به‌جای دادهٔ ناموجود نمایش داده نمی‌شود.</p>
        : <>{report.measurement.first_usage_counter ? <p className="mg-hint">اولین شمارندهٔ موجود: {date(report.measurement.first_usage_counter)}</p>
          : <p className="mg-empty">هنوز رویدادی در شمارنده ثبت نشده است. این وضعیت به‌تنهایی به معنی استفاده‌نشدن از برنامه نیست.</p>}
          {visible.length ? <ul className="mg-analytics-modules">{visible.map(row => <li key={row.module}><div className="mg-module-heading"><h3>{moduleLabels[row.module]}</h3>
            <dl><Metric label="بازشدن" value={row.opens} /><Metric label="درخواست موفق" value={requests(row)} /></dl></div>
            <details><summary>جزئیات درخواست‌ها</summary><dl className="mg-analytics-stats">
              <Metric label="ایجاد" value={row.creates} /><Metric label="ویرایش" value={row.updates} />
              <Metric label="انجام یا تسویه" value={row.completes} /><Metric label="حذف" value={row.deletes} />
            </dl></details></li>)}</ul> : <p className="mg-empty">در این بازه، استفاده‌ای در شمارنده ثبت نشده است.</p>}
          <button aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "نمایش بخش‌های پرکاربرد" : "نمایش همهٔ بخش‌ها، همراه شمارنده‌های صفر"}</button>
          <p className="mg-hint mg-analytics-note">این شمارنده‌ها تعداد افراد یکتا یا زمان استفاده را نشان نمی‌دهند. بازشدن بخش‌ها در حالت آفلاین ثبت نمی‌شود.</p>
        </>}
    </Section>
    <Section title="خطاهای ورود و ثبت‌نام" note="خطاهای ذخیره‌شدهٔ همین دو مسیر در بازه؛ خطاهای سرور زیرمجموعهٔ این مجموع هستند.">
      {report.errors ? <dl className="mg-analytics-stats"><Metric label="خطای ورود" value={report.errors.login} />
        <Metric label="خطای ثبت‌نام" value={report.errors.registration} /><Metric label="از این میان، خطای سرور" value={report.errors.server} />
      </dl> : <p className="mg-empty">شمارندهٔ خطا در این نسخه در دسترس نیست.</p>}
    </Section>
    <Section title="حجم فعلی داده‌های نرم‌افزار" note="فقط تعداد کل رکوردهای موجود؛ بدون مبلغ، شرح، فایل یا اطلاعات مربوط به فرد و خانوادهٔ مشخص.">
      {report.records ? <dl className="mg-analytics-stats">
        <Metric label="تراکنش معمولی" value={report.records.transactions} /><Metric label="برنامهٔ مالی تکرارشونده" value={report.records.scheduled_plans} />
        <Metric label="کار باز" value={report.records.open_tasks} /><Metric label="کار انجام‌شده" value={report.records.completed_tasks} />
        <Metric label="لیست خرید" value={report.records.shopping_lists} /><Metric label="سند ثبت‌شده" value={report.records.documents} />
      </dl> : <p className="mg-empty">گزارش تعداد رکوردها در این نسخه در دسترس نیست.</p>}
      <details className="mg-analytics-daily"><summary>تعداد رکوردهای سایر بخش‌ها</summary><dl className="mg-analytics-stats">
        {(Object.entries(recordLabels) as [keyof ProductReport["record_inventory"], string][]).map(([key, label]) => <Metric key={key} label={label} value={report.record_inventory[key]} />)}
      </dl><p className="mg-hint mg-analytics-note">بخش نصب‌نشده با «اندازه‌گیری‌نشده» مشخص است. تعداد رکوردها با دفعات استفاده یا تعداد خانواده‌های استفاده‌کننده یکسان نیست.</p></details>
      {report.lifetime_usage && <p className="mg-hint mg-analytics-note">از اولین شمارندهٔ موجود تا این بررسی: {number(report.lifetime_usage.opens)} بازشدن بخش و {number(report.lifetime_usage.requests)} درخواست موفق ثبت شده است.</p>}
    </Section>
    <Section title="نکته‌هایی برای بررسی محصول" note="این پیشنهادها از شمارنده‌های موجود می‌آیند و علت رفتار کاربران را اثبات نمی‌کنند."><ul className="mg-analytics-insights">
      {busiest && <li>بیشترین درخواست موفق در «{moduleLabels[busiest.module]}» ثبت شده است؛ آزمون پایداری این بخش می‌تواند اولویت بررسی باشد.</li>}
      {popular && <li>«{moduleLabels[popular.module]}» بیشتر از بخش‌های دیگر باز شده است؛ خوانایی و سرعت این صفحه را بررسی کنید.</li>}
      {snapshot.pending_accounts > 0 && <li>{number(snapshot.pending_accounts)} حساب منتظر تأیید عضویت است؛ مسیر دعوت و تأیید را بررسی کنید.</li>}
      {(report.errors?.total ?? 0) > 0 && <li>{number(report.errors!.total)} خطای ورود یا ثبت‌نام در بازه ثبت شده است؛ علت خطاها را در بررسی فنی پیگیری کنید.</li>}
      {!busiest && !popular && <li>هنوز شمارندهٔ کافی برای اولویت‌بندی بخش‌ها وجود ندارد.</li>}
    </ul></Section>
    <Section title="حدود این گزارش و چیزهایی که هنوز اندازه‌گیری نمی‌شوند">
      <p>این گزارش از شمارنده‌های کلی و تعداد رکوردها ساخته می‌شود. نام، شماره، شناسهٔ کاربر یا خانواده، متن پیامک، مبالغ، محتوای سند و اطلاعات دستگاه در گزارش یا فایل خروجی قرار نمی‌گیرند.</p>
      <ul className="mg-analytics-insights"><li>بازدید سایت معرفی و تعداد کلیک دانلود، فعلاً شمارنده ندارند.</li>
        <li>کاربران فعال یکتا، نرخ بازگشت و زمان استفاده از داده‌های فعلی قابل محاسبه نیستند.</li>
        <li>آمار مستقل استفاده از دستیار هنوز ثبت نمی‌شود.</li>
        <li>روند ساخت خانواده و تکمیل ثبت‌نام از رکوردهای موجود به دست می‌آید؛ موارد حذف‌شده و تاریخچهٔ ثبت‌نشده در آن نیستند.</li>
        <li>ورود موفق با استفادهٔ روزانه یکسان نیست؛ حسابی که وارد می‌ماند ممکن است بدون ورود دوباره از برنامه استفاده کند.</li>
      </ul><p className="mg-hint">آخرین بررسی: {date(report.checked_at)}</p>
    </Section>
  </>;
}

export function ProductAnalytics({ refresh }: { refresh: number }) {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [report, setReport] = useState<ProductReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setLoading(true); setReport(null); setError("");
    void api.get<ProductReport>(`/state/analytics?days=${days}`).then(value => { if (current) setReport(value); })
      .catch((e: unknown) => { if (current) setError(e instanceof Error ? e.message : "دریافت گزارش آماری کامل نشد."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [days, refresh]);
  return <div className="mg-analytics"><label className="mg-analytics-period"><span id="mg-analytics-period-label">بازهٔ آمار</span><select aria-labelledby="mg-analytics-period-label" value={days} onChange={event => setDays(Number(event.target.value) as AnalyticsDays)}>
    <option value={7}>۷ روز اخیر</option><option value={30}>۳۰ روز اخیر</option><option value={90}>۹۰ روز اخیر</option>
  </select></label>{loading ? <div className="mg-state" role="status">در حال دریافت آمار تجمیعی…</div>
    : error ? <div className="mg-state mg-error" role="alert"><strong>گزارش آماری دریافت نشد</strong><p>{error}</p><p>با دکمهٔ «بررسی دوباره» دوباره تلاش کنید.</p></div>
      : report && <Report key={days + ":" + report.checked_at} report={report} />}</div>;
}
