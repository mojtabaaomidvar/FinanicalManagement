import { useState } from "react";
import type { SupportUsage as UsageData } from "./api";

const moduleLabels: Record<string, string> = {
  dashboard: "داشبورد مالی", transactions: "تراکنش‌ها", accounts: "کیف پول‌ها", budgets: "بودجه‌ها",
  bills: "قبوض و شارژ", reports: "گزارش‌ها", calendar: "تقویم و مناسبت‌ها", shopping: "لیست خرید",
  inventory: "انبار خانه", tasks: "کارهای خانه", documents: "اسناد خانه", meals: "برنامهٔ غذایی",
  equipment: "وسایل خانه", vehicles: "خودرو", goals: "اهداف و آرزوها", activities: "برنامه‌های خانوادگی",
  children: "فرزندان", pets: "حیوانات خانگی", market: "بازار", settings: "تنظیمات", notifications: "اعلان‌ها",
};
const number = (value: number) => value.toLocaleString("fa-IR");
const operations = (module: UsageData["modules"][number]) => module.creates + module.updates + module.completes + module.deletes;

function UsageMetric({ label, value }: { label: string; value: number }) {
  return <div className="support-metric"><span>{label}</span><strong>{number(value)}</strong></div>;
}

export function SupportUsage({ data, days, onDaysChange }: { data: UsageData; days: number; onDaysChange: (days: number) => void }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const ranked = [...data.modules].sort((a,b) => b.opens - a.opens || operations(b) - operations(a) || a.module.localeCompare(b.module));
  const popular = ranked.filter(module => module.opens > 0).slice(0,5);
  const largest = Math.max(1, ...popular.map(module => module.opens));
  const visible = showEmpty ? ranked : ranked.filter(module => module.opens || operations(module));
  return <>
    <section className="support-section"><div className="support-section-heading"><div><h2>استفاده از بخش‌های خانه</h2>
      <p>آمار کلی نرم‌افزار در بازهٔ انتخاب‌شده</p></div><label className="support-period">بازه<select value={days}
        onChange={event => onDaysChange(Number(event.target.value))}><option value={7}>۷ روز اخیر</option><option value={30}>۳۰ روز اخیر</option></select></label></div>
      <div className="support-secondary-metrics"><UsageMetric label="بازشدن بخش‌ها" value={data.modules.reduce((sum,module) => sum+module.opens,0)} />
        <UsageMetric label="عملیات موفق" value={data.modules.reduce((sum,module) => sum+operations(module),0)} /></div>
      <h2>بخش‌های پربازدید</h2>
      {popular.length ? <ol className="support-popular">{popular.map(module => <li key={module.module}>
        <div><span>{moduleLabels[module.module]}</span><strong>{number(module.opens)}</strong></div>
        <div className="support-popular-track"><i style={{ width: `${module.opens/largest*100}%` }} /></div></li>)}</ol>
        : <div className="support-state"><p>هنوز بازدیدی برای این بازه ثبت نشده است.</p></div>}
      <p className="support-caption">شمارش بازدید و عملیات از فعال‌شدن این نسخه شروع شده است. این عددها تعداد کاربران یکتا نیستند.</p>
    </section>
    <section className="support-section support-user-list"><div className="support-section-heading"><h2>فعالیت هر بخش</h2>
      <label className="support-show-empty"><input type="checkbox" checked={showEmpty} onChange={event => setShowEmpty(event.target.checked)} />بخش‌های بدون فعالیت</label></div>
      {visible.length ? <div className="support-table-scroll"><table><thead><tr><th>بخش</th><th>بازشدن</th><th>ایجاد</th><th>ویرایش</th><th>انجام یا تسویه</th><th>حذف</th></tr></thead>
        <tbody>{visible.map(module => <tr key={module.module}><td>{moduleLabels[module.module]}</td><td>{number(module.opens)}</td>
          <td>{number(module.creates)}</td><td>{number(module.updates)}</td><td>{number(module.completes)}</td><td>{number(module.deletes)}</td></tr>)}</tbody></table></div>
        : <div className="support-state"><p>هنوز عملیاتی در این بازه ثبت نشده است.</p></div>}
      <p className="support-caption support-table-caption">عملیات، تعداد درخواست‌های موفق است؛ یک درخواست می‌تواند چند رکورد را تغییر دهد و تکرار درخواست هم در این شمارش می‌آید.</p>
    </section>
    <section className="support-section"><div className="support-section-heading"><div><h2>تعداد فعلی رکوردها</h2>
      <p>مجموع کل نرم‌افزار؛ مستقل از بازهٔ بازدید</p></div></div>
      <div className="support-record-metrics"><UsageMetric label="تراکنش ثبت‌شده" value={data.records.transactions} />
        <UsageMetric label="برنامهٔ تکرارشونده" value={data.records.scheduled_plans} /><UsageMetric label="کار باز" value={data.records.open_tasks} />
        <UsageMetric label="کار انجام‌شده" value={data.records.completed_tasks} /><UsageMetric label="لیست خرید" value={data.records.shopping_lists} />
        <UsageMetric label="سند ثبت‌شده" value={data.records.documents} /></div>
      <p className="support-caption">این آمار فقط تعداد کلی است و به کاربر یا خانوادهٔ مشخصی وصل نمی‌شود.</p>
    </section>
  </>;
}
