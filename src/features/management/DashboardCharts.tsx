import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { AnalyticsPoint, ProductReport } from "./analytics.types";
import { rankModules, trendGeometry, type TrendField } from "./dashboard.rules";
import { moduleLabels } from "./ProductAnalytics";

export const formatCount = (value: number) => value.toLocaleString("fa-IR");
export const formatDay = (value: string) => new Intl.DateTimeFormat("fa-IR", {
  month: "short", day: "numeric", timeZone: "Asia/Tehran",
}).format(new Date(value + "T12:00:00+03:30"));

export function DailyChart({ title, points, fields }: {
  title: string; points: AnalyticsPoint[]; fields: { key: TrendField; label: string }[];
}) {
  const id = useId();
  const [field, setField] = useState<TrendField>(fields[0].key);
  const [selected, setSelected] = useState(points.length - 1);
  const drawing = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(660);
  useEffect(() => {
    const element = drawing.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(220, entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [points.length, field]);
  const geometry = trendGeometry(points, field, width);
  const index = Math.max(0, Math.min(selected, points.length - 1));
  const current = points[index];
  const dot = geometry.coordinates[index];
  const label = fields.find(item => item.key === field)!.label;
  function inspect(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = ((event.clientX - bounds.left) / bounds.width * width - 52) / (width - 80);
    setSelected(Math.max(0, Math.min(points.length - 1, Math.round(fraction * (points.length - 1)))));
  }
  const selectionLabel = /* @copy-text management.dashboard.day_selector */ `روز نمودار ${title}`;
  return <figure className="mg-dash-chart" data-field={field}>
    <figcaption className="mg-dash-heading"><h2 id={id}>{title}</h2><label>
      <span className="mg-sr-only">شاخص نمودار</span>
      <select value={field} onChange={event => setField(event.target.value as TrendField)} aria-labelledby={id}>
        {fields.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label></figcaption>
    <div className="mg-dash-chart-total"><strong>{geometry.total === null ? "—" : formatCount(geometry.total)}</strong>
      <span>{label} در بازه</span></div>
    {!geometry.available ? <p className="mg-empty">داده‌ای برای این نمودار در دسترس نیست؛ مقدار ناموجود صفر محسوب نمی‌شود.</p> : <>
      <svg ref={drawing} viewBox={`0 0 ${width} 208`} aria-hidden="true" onPointerMove={inspect} onPointerDown={inspect}>
        {geometry.ticks.map(tick => {
          const y = 176 - tick / geometry.maximum * 152;
          return <g key={tick}><line x1="52" x2={width - 28} y1={y} y2={y} className="mg-dash-gridline" />
            <text x="40" y={y + 5} textAnchor="end">{formatCount(tick)}</text></g>;
        })}
        {geometry.segments.map((segment, position) => <g key={position}>
          <polyline points={segment.map(point => `${point.x},${point.y}`).join(" ")} className="mg-dash-line" />
          {segment.length === 1 && <circle cx={segment[0].x} cy={segment[0].y} r="4" className="mg-dash-dot" />}
        </g>)}
        {dot && <><line x1={dot.x} x2={dot.x} y1="24" y2="176" className="mg-dash-cursor" />
          <circle cx={dot.x} cy={dot.y} r="5" className="mg-dash-dot" /></>}
      </svg>
      <div className="mg-dash-dates" dir="ltr"><span dir="rtl">{formatDay(points[0].day)}</span><span dir="rtl">{formatDay(points[points.length - 1].day)}</span></div>
      <div className="mg-dash-readout" aria-live="polite" aria-atomic="true"><span>{formatDay(current.day)}</span>
        <strong>{current[field] === null ? "اندازه‌گیری‌نشده" : formatCount(current[field]!)}</strong><span>{label}</span></div>
      <input type="range" className="mg-dash-slider" min={0} max={Math.max(0, points.length - 1)} value={index}
        aria-label={selectionLabel} aria-valuetext={formatDay(current.day)} dir="ltr"
        onChange={event => setSelected(Number(event.target.value))} />
      {!geometry.complete && <p className="mg-hint">دادهٔ بعضی روزها موجود نیست؛ نمودار در آن روزها قطع و جمع بازه نامشخص است.</p>}
      <details><summary>جدول عددهای نمودار</summary><div className="mg-table-wrap"><table>
        <thead><tr><th scope="col">روز</th><th scope="col">{label}</th></tr></thead>
        <tbody>{points.map(point => <tr key={point.day}><td>{formatDay(point.day)}</td>
          <td>{point[field] === null ? "اندازه‌گیری‌نشده" : formatCount(point[field]!)}</td></tr>)}</tbody>
      </table></div></details>
    </>}
    {geometry.available && geometry.total === 0 && <p className="mg-hint">در این بازه رویدادی برای این شاخص ثبت نشده است.</p>}
  </figure>;
}

export function ModuleChart({ report }: { report: ProductReport }) {
  const id = useId();
  const [metric, setMetric] = useState<"requests" | "opens">("requests");
  const ranked = rankModules(report.modules ?? [], metric);
  const visible = ranked.slice(0, 6);
  const maximum = Math.max(1, ...visible.map(row => row.value));
  const total = ranked.reduce((sum, row) => sum + row.value, 0);
  return <section className="mg-section mg-dash-modules"><div className="mg-dash-heading"><h2>بخش‌های پرکاربرد</h2>
    <label><span id={id} className="mg-sr-only">معیار رتبه‌بندی بخش‌ها</span><select aria-labelledby={id} value={metric} onChange={event => setMetric(event.target.value as typeof metric)}>
      <option value="requests">درخواست موفق</option><option value="opens">بازشدن بخش</option>
    </select></label></div>
    {!report.measurement.usage_available || !report.modules ? <p className="mg-empty">شمارندهٔ استفاده در این نسخه در دسترس نیست.</p>
      : !visible.length ? <p className="mg-empty">در این بازه استفاده‌ای در شمارنده ثبت نشده است.</p>
        : <><ol className="mg-dash-ranking">{visible.map(row => <li key={row.module}>
          <div><span>{moduleLabels[row.module]}</span><strong>{formatCount(row.value)}</strong></div>
          <svg viewBox="0 0 600 12" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0" y="0" width="600" height="12" className="mg-dash-bar-track" />
            <rect x={600 - row.value / maximum * 600} y="0" width={row.value / maximum * 600} height="12" className="mg-dash-bar" />
          </svg>
        </li>)}</ol><p className="mg-hint">شش بخش اول از {formatCount(ranked.length)} بخش دارای شمارنده؛ مجموع این شاخص در همهٔ بخش‌ها: {formatCount(total)}.</p></>}
    <p className="mg-hint">این عددها تعداد درخواست یا بازشدن‌اند و تعداد کاربران یکتا نیستند.</p>
  </section>;
}

export function MembershipChart({ snapshot }: { snapshot: ProductReport["snapshot"] }) {
  const total = snapshot.active_accounts + snapshot.pending_accounts + snapshot.inactive_accounts;
  const entries = [
    { label: "عضویت فعال", count: snapshot.active_accounts, className: "mg-dash-member-active" },
    { label: "در انتظار تأیید", count: snapshot.pending_accounts, className: "mg-dash-member-pending" },
    { label: "عضویت غیرفعال", count: snapshot.inactive_accounts, className: "mg-dash-member-inactive" },
  ];
  let offset = 0;
  return <section className="mg-section mg-dash-members"><h2>وضعیت حساب‌ها</h2>
    {total > 0 ? <div className="mg-dash-members-body"><div className="mg-dash-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true">{entries.map(entry => {
        const percent = entry.count / total * 100;
        const segment = <circle key={entry.className} cx="80" cy="80" r="64" fill="none" pathLength="100"
          strokeWidth="14" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-offset}
          transform="rotate(-90 80 80)" className={entry.className} />;
        offset += percent;
        return segment;
      })}</svg><div><strong>{formatCount(total)}</strong><span>حساب</span></div></div>
      <dl>{entries.map(entry => <div key={entry.className}><dt><span className={entry.className} aria-hidden="true" />{entry.label}</dt><dd>{formatCount(entry.count)}</dd></div>)}</dl>
    </div> : <p className="mg-empty">حساب ثبت‌نام‌کامل برای نمایش وجود ندارد.</p>}
    <p className="mg-hint">وضعیت فعلی حساب‌های ثبت‌نام‌کامل؛ پروفایل‌های بدون حساب مستقل در این نمودار نیستند.</p>
  </section>;
}
