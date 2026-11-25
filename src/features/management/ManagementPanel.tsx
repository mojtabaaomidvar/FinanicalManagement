import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { managementApi as api, type Account, type Audit, type Backup, type Credential, type Job, type Operation,
  type Overview, type Plan, type Release, type Role, type Service, type Session, type Settings, type User } from "./api";
import { actionDescriptions, actionLabels, auditLabels, environmentLabels, flagLabels, ownerOperations,
  pageLabels, roleLabels, secretKeys, sensitiveOperations, serviceLabels, stateLabels, type Page } from "./labels";
import mark from "../../../public/khaneyar-mark.png";
import { ProductAnalytics } from "./ProductAnalytics";
import "./management.css";

const number = (value: number, digits = 0) => value.toLocaleString("fa-IR", { maximumFractionDigits: digits });
const date = (value: number | string) => new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran",
}).format(new Date(typeof value === "number" ? value * 1000 : value));
function bytes(value: number) {
  const label = value >= 1024 ** 3 ? "گیگابایت" : "مگابایت";
  return `${number(value / (value >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2), 1)} ${label}`;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "درخواست کامل نشد؛ دوباره تلاش کنید.";

function useResource<T>(path: string, refresh: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setData(null); setError(""); setLoading(true);
    void api.get<T>(path).then(value => { if (current) setData(value); })
      .catch((e: unknown) => { if (current) setError(errorMessage(e)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [path, refresh]);
  return { data, error, loading };
}

function State({ loading, error, children }: { loading: boolean; error: string; children: ReactNode }) {
  if (loading) return <div className="mg-state" role="status">در حال بررسی وضعیت…</div>;
  if (error) return <div className="mg-state mg-error" role="alert"><strong>دریافت اطلاعات کامل نشد</strong><p>{error}</p><p>با دکمهٔ «بررسی دوباره» دوباره تلاش کنید.</p></div>;
  return <>{children}</>;
}
function Badge({ state }: { state: string }) {
  const healthy = ["available", "active", "running", "succeeded"].includes(state);
  const failed = ["unavailable", "failed", "suspended", "interrupted"].includes(state);
  return <span className={`mg-badge ${healthy ? "mg-good" : failed ? "mg-bad" : ""}`}>{stateLabels[state] ?? <bdi dir="ltr">{state}</bdi>}</span>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="mg-empty">{children}</p>; }
function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <section className="mg-section"><div className="mg-section-heading"><h2>{title}</h2>{note && <p>{note}</p>}</div>{children}</section>;
}
function Icon({ page }: { page: Page }) {
  const paths: Record<Page, string> = {
    overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    analytics: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
    server: "M3 3h18v7H3z M3 14h18v7H3z M7 6.5h.1 M7 17.5h.1",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    backups: "M3 7h18v14H3z M7 3h10v4 M9 12h6 M12 12v5",
    releases: "M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4",
    logs: "M5 3h14v18H5z M8 7h8 M8 12h8 M8 17h5",
    accounts: "M12 3l8 4v5c0 5-8 9-8 9s-8-4-8-9V7z M9 12l2 2 4-4",
    history: "M3 11a9 9 0 1 1 3 8 M3 4v7h7 M12 7v5l3 2",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[page]} /></svg>;
}
type Act = (operation: Operation) => void;
type Props = { refresh: number; role: Role; act: Act; busy: boolean };
function Action({ operation, act, role, busy, children, danger = false }: { operation: Operation; act: Act; role: Role; busy: boolean; children: ReactNode; danger?: boolean }) {
  if (role === "viewer" || (ownerOperations.has(operation.kind) && role !== "owner")) return null;
  return <button type="button" disabled={busy} className={danger ? "mg-danger" : ""} onClick={() => act(operation)}>{children}</button>;
}

function OverviewPage({ refresh, role, act, busy }: Props) {
  const resource = useResource<Overview>("/state/overview", refresh);
  const data = resource.data;
  const pct = (used: number, total: number) => Math.round(used / total * 100);
  return <State {...resource}>{data && <>
    <div className="mg-overview-lead"><div><span className="mg-muted">وضعیت همین لحظه</span><h2>{data.api === "available" && data.database === "available" ? "خانه‌یار در دسترس است" : "سرویس‌ها به بررسی نیاز دارند"}</h2><p>آخرین بررسی: {date(data.checked_at)}</p></div><Badge state={data.api} /></div>
    <dl className="mg-facts"><div><dt>نسخهٔ برنامه</dt><dd><bdi dir="ltr">{data.version || "—"}</bdi></dd></div><div><dt>زمان روشن‌بودن سرور</dt><dd>{number(Math.floor(data.uptime_seconds / 86400))} روز</dd></div><div><dt>پایگاه داده</dt><dd><Badge state={data.database} /></dd></div></dl>
    <Section title="منابع سرور" note="مقادیر از میزبان سرویس‌ها خوانده می‌شوند."><div className="mg-resources"><div><span>بار پردازنده</span><strong>{number(data.cpu_load, 2)}</strong><p>{number(data.cpu_cores)} هستهٔ پردازشی</p></div>{[{ label: "حافظهٔ رم", used: data.memory_used, total: data.memory_total }, { label: "فضای دیسک", used: data.disk_used, total: data.disk_total }].map(item => <div key={item.label}><span>{item.label}</span><strong>{number(pct(item.used, item.total))}٪</strong><meter min={0} max={100} value={pct(item.used, item.total)} aria-label={item.label} /><p>{bytes(item.used)} از {bytes(item.total)}</p></div>)}</div></Section>
    <Section title="سرویس‌ها"><div className="mg-service-list">{data.services.map(item => <div key={item.id}><strong>{serviceLabels[item.id]}</strong><Badge state={item.state} /></div>)}</div></Section>
    <div className="mg-actions"><Action {...{ role, act, busy }} operation={{ kind: "backup.create" }}>ساخت پشتیبان کامل</Action><Action {...{ role, act, busy }} operation={{ kind: "nginx.reload" }}>بررسی و بارگذاری وب‌سرور</Action></div>
  </>}</State>;
}

function ServerPage(props: Props) {
  const resource = useResource<{ items: Service[] }>("/state/services", props.refresh);
  return <State {...resource}><Section title="کنترل سرویس‌ها" note="پنل مدیریت مستقل از سرویس برنامه اجرا می‌شود."><div className="mg-service-controls">{resource.data?.items.map(item => <div key={item.id}><div><h3>{serviceLabels[item.id]}</h3>{item.image && <bdi className="mg-muted" dir="ltr">{item.image}</bdi>}</div><Badge state={item.state} /><div className="mg-actions">{item.id === "nginx" ? <Action {...props} operation={{ kind: "nginx.reload" }}>بررسی و بارگذاری</Action> : <><Action {...props} operation={{ kind: "service.start", target: item.id }}>شروع</Action><Action {...props} operation={{ kind: "service.restart", target: item.id }}>راه‌اندازی مجدد</Action><Action {...props} operation={{ kind: "service.stop", target: item.id }} danger>توقف</Action></>}</div></div>)}</div></Section>
    <Section title="گواهی و میزبان"><p>گواهی‌های امنیتی و راه‌اندازی مجدد کل سرور از این بخش کنترل می‌شوند.</p><div className="mg-actions"><Action {...props} operation={{ kind: "certificate.renew" }}>بررسی و تمدید گواهی‌ها</Action><Action {...props} operation={{ kind: "host.reboot" }} danger>راه‌اندازی مجدد سرور</Action><Action {...props} operation={{ kind: "host.cancel_reboot" }}>لغو راه‌اندازی مجدد</Action></div></Section>
  </State>;
}

function UsersPage(props: Props) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const resource = useResource<{ items: User[]; total: number }>(`/state/users?search=${encodeURIComponent(search)}&offset=${offset}`, props.refresh);
  return <><form className="mg-filter" onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setOffset(0); }}><label>کد پشتیبانی یا شمارهٔ کامل<input value={draft} onChange={e => setDraft(e.target.value)} maxLength={64} dir="ltr" /></label><button>جست‌وجو</button></form>
    <State {...resource}><Section title="حساب‌های کاربران" note="شماره‌ها به‌صورت پوشیده نمایش داده می‌شوند.">
      {resource.data?.items.length ? <ul className="mg-users">{resource.data.items.map(user => <li key={user.id}>
        <div className="mg-user-ident"><span className="mg-hint">کد پشتیبانی</span><code dir="ltr">{user.id}</code><Badge state={user.state} /></div>
        <dl><div><dt>شماره</dt><dd><bdi dir="ltr">{user.phone || "—"}</bdi></dd></div>
          <div><dt>آخرین ورود</dt><dd>{user.last_login ? date(user.last_login) : "سابقه‌ای ثبت نشده"}</dd></div></dl>
        <div className="mg-actions">
          {user.state === "active" && <Action {...props} operation={{ kind: "user.suspend", target: user.id }} danger>تعلیق</Action>}
          {user.state === "suspended" && <Action {...props} operation={{ kind: "user.activate", target: user.id }}>رفع تعلیق</Action>}
          <Action {...props} operation={{ kind: "user.revoke_sessions", target: user.id }}>پایان نشست‌ها</Action>
        </div>
      </li>)}</ul> : <Empty>کاربری با این جست‌وجو پیدا نشد.</Empty>}
      <div className="mg-pagination"><button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))}>قبلی</button><span>{number(resource.data?.total ?? 0)} حساب</span><button disabled={offset + 25 >= (resource.data?.total ?? 0)} onClick={() => setOffset(value => value + 25)}>بعدی</button></div>
    </Section></State></>;
}

function SettingsForm({ data, ...props }: Props & { data: Settings }) {
  const [values, setValues] = useState<Record<string, string | boolean>>({ ...data.flags, ...Object.fromEntries(Object.entries(data.environment).filter(([key]) => !secretKeys.has(key))) });
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const update = (key: string, value: string | boolean) => { setValues(previous => ({ ...previous, [key]: value })); setDirty(previous => new Set(previous).add(key)); };
  return <form onSubmit={event => { event.preventDefault(); props.act({ kind: "settings.update", values: Object.fromEntries([...dirty].map(key => [key, values[key]])) }); }}>
    <Section title="دسترسی و وضعیت برنامه">{!data.runtime_supported && <p className="mg-error" role="status">کنترل تعمیرات، ثبت‌نام و دستیار پس از نصب نسخهٔ سازگار برنامه و فعال‌کردن اتصال مدیریت در دسترس است.</p>}<div className="mg-switches">{Object.entries(flagLabels).map(([key, label]) => <label key={key}><span>{label}</span><input type="checkbox" checked={Boolean(values[key])} onChange={event => update(key, event.target.checked)} disabled={props.role === "viewer" || (!data.runtime_supported && key !== "otp_enabled")} /></label>)}</div><p className="mg-muted">حالت تعمیرات، دسترسی کاربران به برنامه را موقتاً متوقف می‌کند. فعال‌کردن کد ورود به درگاه پیامکِ تنظیم‌شده نیاز دارد.</p></Section>
    <Section title="پیامک و دستیار" note="کلیدهای ذخیره‌شده نمایش داده نمی‌شوند. فیلدهای بدون تغییر حفظ می‌شوند."><div className="mg-form-grid">{Object.entries(environmentLabels).map(([key, label]) => <label key={key}>{label}{secretKeys.has(key) ? <><input type="password" autoComplete="new-password" value={String(values[key] ?? "")} onChange={e => update(key, e.target.value)} disabled={props.role === "viewer"} placeholder={data.environment[key] ? "کلید تنظیم شده؛ برای تغییر بنویسید" : "کلیدی تنظیم نشده است"} dir="ltr" /><span className="mg-hint">{data.environment[key] ? "کلید فعلی موجود است." : "این اتصال هنوز کلید ندارد."}</span></> : key === "SMS_PROVIDER" ? <select value={String(values[key] ?? "")} onChange={e => update(key, e.target.value)} disabled={props.role === "viewer"}><option value="">غیرفعال</option><option value="kavenegar">کاوه‌نگار</option></select> : <input type={key === "AI_SMS_GATEWAY_URL" ? "url" : "text"} maxLength={1024} value={String(values[key] ?? "")} onChange={e => update(key, e.target.value)} disabled={props.role === "viewer"} dir="ltr" />}</label>)}</div></Section>
    {props.role !== "viewer" && <button className="mg-primary" disabled={!dirty.size || props.busy}>بررسی و ذخیرهٔ تغییرها</button>}
  </form>;
}
function SettingsPage(props: Props) {
  const resource = useResource<Settings>("/state/settings", props.refresh);
  return <State {...resource}>{resource.data && <SettingsForm key={resource.data.revision} data={resource.data} {...props} />}</State>;
}

function BackupsPage(props: Props & { download: (id: string) => void }) {
  const resource = useResource<{ items: Backup[]; scheduled: boolean }>("/state/backups", props.refresh);
  return <State {...resource}><div className="mg-actions mg-toolbar"><Action {...props} operation={{ kind: "backup.create" }}>ساخت پشتیبان کامل</Action><Action {...props} operation={{ kind: "backup.schedule", values: { enabled: !resource.data?.scheduled } }}>{resource.data?.scheduled ? "غیرفعال‌کردن پشتیبان روزانه" : "فعال‌کردن پشتیبان روزانه"}</Action><span className="mg-muted">{resource.data?.scheduled ? "پشتیبان روزانه فعال است." : "پشتیبان روزانه غیرفعال است."}</span></div>
    <Section title="پشتیبان‌های کامل" note="هر پشتیبان، دیتابیس و فایل‌ها و تنظیمات و تصویر نسخهٔ برنامه را همراه دارد.">{resource.data?.items.length ? <ul className="mg-records">{resource.data.items.map(backup => <li key={backup.id}><div><h3>{date(backup.created_at)}</h3><code dir="ltr">{backup.id}</code><p className="mg-muted">{bytes(backup.bytes)}</p></div><div className="mg-actions"><Action {...props} operation={{ kind: "backup.verify", target: backup.id }}>بررسی</Action>{props.role === "owner" && <button disabled={props.busy} onClick={() => props.download(backup.id)}>دریافت</button>}<Action {...props} operation={{ kind: "backup.restore", target: backup.id }} danger>بازیابی</Action></div></li>)}</ul> : <Empty>هنوز پشتیبان کاملی ثبت نشده است. اولین پشتیبان را از همین صفحه بسازید.</Empty>}</Section>
  </State>;
}

function ReleasesPage(props: Props) {
  const [tag, setTag] = useState("");
  const resource = useResource<{ items: Release[] }>("/state/releases", props.refresh);
  return <><Section title="دریافت نسخهٔ رسمی" note="دریافت و بررسی بسته، پیش از نصب انجام می‌شود.">{props.role !== "viewer" && <form className="mg-filter" onSubmit={event => { event.preventDefault(); props.act({ kind: "release.fetch", target: tag }); }}><label>شمارهٔ نسخه<input required pattern="v[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}" placeholder="v0.6.0" value={tag} onChange={e => setTag(e.target.value)} dir="ltr" /></label><button disabled={props.busy}>دریافت و بررسی</button></form>}</Section>
    <State {...resource}><Section title="نسخه‌های آمادهٔ نصب">{resource.data?.items.length ? <ul className="mg-records">{resource.data.items.map(release => <li key={release.tag}><div><h3><bdi dir="ltr">{release.tag}</bdi></h3><p>{date(release.fetched_at)}</p><code className="mg-hash" dir="ltr">{release.sha256}</code><span className="mg-hint">هش بسته بررسی شده است.</span></div><Action {...props} operation={{ kind: "release.install", target: release.tag }}>بررسی و نصب</Action></li>)}</ul> : <Empty>بسته‌ای دریافت نشده است. شمارهٔ نسخهٔ رسمی را وارد کنید.</Empty>}</Section></State></>;
}

function LogsPage({ refresh }: Props) {
  const [target, setTarget] = useState("api");
  const resource = useResource<{ text: string }>(`/state/logs?target=${target}`, refresh);
  return <><label className="mg-log-select">سرویس<select value={target} onChange={e => setTarget(e.target.value)}>{Object.entries(serviceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><State {...resource}><Section title="آخرین رخدادهای سرویس" note="حداکثر ۱۵۰ خط اخیر، با حذف الگوهای شناخته‌شدهٔ کلید و شماره، نمایش داده می‌شود.">{resource.data?.text ? <pre className="mg-log" dir="ltr">{resource.data.text}</pre> : <Empty>رخدادی برای نمایش وجود ندارد.</Empty>}</Section></State></>;
}

function CredentialFields({ password, setPassword, code, setCode, mfa }: { password: string; setPassword: (value: string) => void; code: string; setCode: (value: string) => void; mfa: boolean }) {
  return <><label>رمز حساب مدیریت<input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={e => setPassword(e.target.value)} dir="ltr" /></label>{mfa && <label>کد دومرحله‌ای<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ""))} dir="ltr" /><span className="mg-hint">تا پنج دقیقه پس از ورود، نوشتن دوبارهٔ کد لازم نیست.</span></label>}</>;
}

function AccountsPage(props: Props & { session: Session; changed: () => void }) {
  const resource = useResource<{ items: Account[] }>("/accounts", props.refresh);
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [created, setCreated] = useState<{ username: string; totp_secret: string } | null>(null);
  return <><div className="mg-toolbar"><button className="mg-primary" onClick={() => { setCreated(null); setEditing("new"); }}>افزودن مدیر</button></div>{created && <section className="mg-notice" role="status"><strong>حساب مدیریت ساخته شد.</strong>{created.totp_secret && <><p>این کلید را در برنامهٔ رمز دومرحله‌ای حساب تازه ثبت کنید. کلید فقط همین بار نمایش داده می‌شود.</p><code dir="ltr">{created.totp_secret}</code></>}<button onClick={() => setCreated(null)}>بستن</button></section>}
    <State {...resource}><Section title="حساب‌های مدیریت"><ul className="mg-records">{resource.data?.items.map(account => <li key={account.id}><div><h3><bdi dir="ltr">{account.username}</bdi></h3><p>{roleLabels[account.role]} · {account.enabled ? "فعال" : "غیرفعال"}</p><span className="mg-hint">{account.mfa ? "ورود دومرحله‌ای فعال" : "ورود بدون کد دومرحله‌ای"}</span></div><button onClick={() => setEditing(account)}>ویرایش دسترسی</button></li>)}</ul></Section></State>
    {editing && <AccountDialog account={editing} session={props.session} close={() => setEditing(null)} saved={value => { setCreated(value); setEditing(null); props.changed(); }} />}
  </>;
}

function AccountDialog({ account, session, close, saved }: { account: Account | "new"; session: Session; close: () => void; saved: (value: { username: string; totp_secret: string } | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [username, setUsername] = useState(account === "new" ? "" : account.username);
  const [role, setRole] = useState<Role>(account === "new" ? "viewer" : account.role);
  const [enabled, setEnabled] = useState(account === "new" || Boolean(account.enabled));
  const [newPassword, setNewPassword] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      if (account === "new") saved(await api.post("/accounts", { username, role, new_password: newPassword, password, code }));
      else { await api.patch(`/accounts/${account.id}`, { role, enabled, new_password: newPassword, password, code }); saved(null); }
    } catch (e) { setError(errorMessage(e)); setPassword(""); setCode(""); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="mg-dialog" aria-labelledby="mg-account-title"
    onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <form onSubmit={submit}>
      <h2 id="mg-account-title">{account === "new" ? "افزودن مدیر" : "ویرایش حساب مدیریت"}</h2>
      <p>تغییر نقش، غیرفعال‌کردن یا تغییر رمز، نشست‌های قبلی این حساب را باطل می‌کند.</p>
      <label>نام کاربری<input required minLength={3} maxLength={64} pattern={"[a-zA-Z0-9_.\\-]{3,64}"}
        value={username} disabled={account !== "new"} onChange={e => setUsername(e.target.value)} autoComplete="off" dir="ltr" /></label>
      <label>نقش<select value={role} onChange={e => setRole(e.target.value as Role)}>
        {Object.entries(roleLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      {account !== "new" && <label className="mg-check"><input type="checkbox" checked={enabled}
        onChange={e => setEnabled(e.target.checked)} />حساب فعال باشد</label>}
      <label><span id="mg-new-password-label">رمز حساب تازه</span><input type="password" minLength={12}
        maxLength={128} required={account === "new"} autoComplete="new-password" value={newPassword}
        aria-labelledby="mg-new-password-label" aria-describedby="mg-new-password-hint"
        onChange={e => setNewPassword(e.target.value)} dir="ltr" />
        <span id="mg-new-password-hint" className="mg-hint">برای حفظ رمز حساب موجود، این فیلد را خالی بگذارید.</span>
      </label>
      <CredentialFields {...{ password, setPassword, code, setCode, mfa: session.mfa }} />
      {error && <p className="mg-error" role="alert">{error}</p>}
      <div className="mg-actions"><button className="mg-primary" disabled={busy}>
        {busy ? "در حال ذخیره…" : "ذخیرهٔ حساب"}</button>
        <button type="button" disabled={busy} onClick={close}>انصراف</button></div>
    </form>
  </dialog>;
}

function HistoryPage({ refresh, role }: Props) {
  const jobs = useResource<{ items: Job[] }>("/jobs", refresh);
  const audit = useResource<{ items: Audit[] }>(role === "owner" ? "/audit" : "/jobs", refresh);
  return <><State {...jobs}><Section title="درخواست‌ها و نتیجه‌ها">{jobs.data?.items.length ? <ul className="mg-records">{jobs.data.items.map(job => <li key={job.id}><div><h3>{actionLabels[job.operation.kind]}</h3><p>{date(job.created)} · <bdi dir="ltr">{job.actor}</bdi></p>{job.operation.target && <code dir="ltr">{job.operation.target}</code>}{job.result?.message && <p className="mg-error">{job.result.message}</p>}{job.result?.safety_backup && <p>پشتیبان پیش از تغییر: <bdi dir="ltr">{job.result.safety_backup}</bdi></p>}<span className="mg-hint"><bdi dir="ltr">{job.id}</bdi></span></div><Badge state={job.status} /></li>)}</ul> : <Empty>هنوز عملیاتی از این پنل ثبت نشده است.</Empty>}</Section></State>{role === "owner" && <State {...audit}><Section title="سابقهٔ دسترسی و تغییرها">{audit.data?.items.length ? <div className="mg-table-wrap"><table><thead><tr><th>زمان</th><th>مدیر</th><th>رخداد</th></tr></thead><tbody>{audit.data.items.map(item => <tr key={item.id}><td>{date(item.created)}</td><td><bdi dir="ltr">{item.actor}</bdi></td><td>{auditLabels[item.event] ?? <bdi dir="ltr">{item.event}</bdi>}</td></tr>)}</tbody></table></div> : <Empty>رخدادی ثبت نشده است.</Empty>}</Section></State>}</>;
}

function ConfirmDialog({ plan, download, session, close, done }: { plan: Plan | null; download: string | null; session: Session; close: () => void; done: (job?: Job) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestKey = useRef(crypto.randomUUID());
  const operation = plan?.operation;
  const sensitive = Boolean(operation && sensitiveOperations.has(operation.kind));
  const target = operation?.target || session.username;
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function execute(event: FormEvent) {
    event.preventDefault(); if (busy || !accepted || (sensitive && confirmation !== target)) return;
    setBusy(true); setError("");
    const credential: Credential = { password, code };
    try {
      if (download) { await api.download(download, credential); done(); }
      else if (plan) done(await api.post<Job>("/jobs", { plan_id: plan.id, request_key: requestKey.current, ...credential }));
    } catch (e) { setError(errorMessage(e)); setPassword(""); setCode(""); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="mg-dialog" aria-labelledby="mg-confirm-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}><form onSubmit={execute}><h2 id="mg-confirm-title">{operation ? actionLabels[operation.kind] : "دریافت پشتیبان"}</h2><p>{operation ? actionDescriptions[operation.kind] : "این فایل شامل اطلاعات برنامه و کلیدهای بازیابی است؛ آن را در محل خصوصی نگه دارید."}</p>{session.mode === "demo" && <p className="mg-demo-note">محیط آزمایشی است؛ این عملیات روی سرور واقعی اجرا نمی‌شود.</p>}{(operation?.target || download) && <code dir="ltr">{operation?.target || download}</code>}{operation?.values && <dl className="mg-confirm-values">{Object.entries(operation.values).map(([key, value]) => <div key={key}><dt>{flagLabels[key] ?? environmentLabels[key] ?? (key === "enabled" ? "پشتیبان روزانه" : key)}</dt><dd>{secretKeys.has(key) ? "کلید تازه دریافت شده است." : typeof value === "boolean" ? value ? "فعال" : "غیرفعال" : <bdi dir="ltr">{value || "—"}</bdi>}</dd></div>)}</dl>}{sensitive && <label>برای تأیید، مقدار زیر را دوباره بنویسید:<code dir="ltr">{target}</code><input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} dir="ltr" /></label>}<CredentialFields {...{ password, setPassword, code, setCode, mfa: session.mfa }} /><label className="mg-check"><input type="checkbox" checked={accepted} required onChange={e => setAccepted(e.target.checked)} />اثر این عملیات را بررسی کرده‌ام.</label>{error && <p className="mg-error" role="alert">{error}</p>}<div className="mg-actions"><button className={sensitive ? "mg-danger" : "mg-primary"} disabled={busy || !accepted || (sensitive && confirmation !== target)}>{busy ? "در حال ثبت درخواست…" : download ? "دریافت فایل" : "تأیید و اجرا"}</button><button type="button" disabled={busy} onClick={close}>انصراف</button></div></form></dialog>;
}

function LoginPage({ mode, ready, notice }: { mode: Session["mode"]; ready: (session: Session) => void; notice: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try { ready(await api.post<Session>("/login", { username, password, code })); }
    catch (e) { setError(errorMessage(e)); setPassword(""); setCode(""); }
    finally { setBusy(false); }
  }
  return <main className="mg-app mg-login" dir="rtl"><div className="mg-login-intro"><img src={mark} width="64" height="64" alt="خانه‌یار" /><h1>مدیریت خانه‌یار</h1><p>سرور، نرم‌افزار و عملیات؛ در یک پنل مستقل.</p><span>دسترسی مخصوص مدیران سامانه</span></div><form className="mg-login-form" onSubmit={login}><h2>ورود به پنل مدیریت</h2>{mode === "demo" && <p className="mg-demo-note">محیط آزمایشی محلی؛ اطلاعات و عملیات نمونه هستند.</p>}{notice && <p role="status">{notice}</p>}<label>نام کاربری<input required autoComplete="username" maxLength={64} value={username} onChange={e => setUsername(e.target.value)} dir="ltr" /></label><CredentialFields {...{ password, setPassword, code, setCode, mfa: mode === "production" }} />{error && <p className="mg-error" role="alert">{error}</p>}<button className="mg-primary" disabled={busy}>{busy ? "در حال ورود…" : "ورود به مدیریت"}</button></form></main>;
}

export function ManagementPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [bootError, setBootError] = useState("");
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<Session["mode"]>("production");
  const [page, setPage] = useState<Page>("overview");
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [download, setDownload] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const generation = useRef(0);
  const expire = useCallback(() => {
    generation.current += 1;
    api.setSession(null); setSession(null); setPlan(null); setDownload(null); setActiveJob(null); setPreparing(false);
    setNotice("نشست مدیریت پایان یافته است؛ دوباره وارد شوید."); setError(""); setPage("overview");
  }, []);
  const ready = useCallback((value: Session) => { api.setSession(value); setSession(value); setMode(value.mode); setNotice(""); setError(""); }, []);
  useEffect(() => {
    let current = true; setChecking(true); setBootError("");
    void api.get<Session>("/session").then(value => { if (current) { setMode(value.mode); if (value.authenticated) ready(value); } })
      .catch((e: unknown) => { if (current) setBootError(errorMessage(e)); }).finally(() => { if (current) setChecking(false); });
    return () => { current = false; };
  }, [retry, ready]);
  useEffect(() => { window.addEventListener("management:unauthorized", expire); return () => window.removeEventListener("management:unauthorized", expire); }, [expire]);
  useEffect(() => {
    if (!session?.expires_at) return;
    const timer = setTimeout(expire, Math.max(0, session.expires_at * 1000 - Date.now()));
    return () => clearTimeout(timer);
  }, [session, expire]);
  useEffect(() => {
    if (!session) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await api.get<{ items: Job[] }>("/jobs");
        if (!current) return;
        const running = result.items.find(job => ["queued", "running"].includes(job.status));
        if (running) { setActiveJob(running); timer = setTimeout(check, 2000); }
        else if (activeJob) {
          const finished = result.items.find(job => job.id === activeJob.id);
          setActiveJob(null); setRefresh(value => value + 1);
          if (finished?.status === "failed") setError(finished.result?.message ?? "عملیات موفق نبود؛ سابقه را بررسی کنید.");
          else if (finished?.status === "succeeded") setNotice("عملیات با موفقیت انجام شد.");
        }
      } catch (e) { if (current) { setError(errorMessage(e)); timer = setTimeout(check, 5000); } }
    }
    void check();
    return () => { current = false; clearTimeout(timer); };
  }, [session, activeJob?.id]);
  async function act(operation: Operation) {
    if (preparing || activeJob) return;
    const current = generation.current;
    setPreparing(true); setError(""); setNotice("");
    try { const value = await api.post<Plan>("/plans", operation); if (current === generation.current) setPlan(value); }
    catch (e) { if (current === generation.current) setError(errorMessage(e)); }
    finally { if (current === generation.current) setPreparing(false); }
  }
  async function logout() {
    if (preparing) return;
    setPreparing(true); setError("");
    try { await api.post("/logout", {}); expire(); setNotice(""); }
    catch (e) { setError(errorMessage(e)); }
    finally { setPreparing(false); }
  }
  if (checking || bootError) return <main className="mg-app mg-boot" dir="rtl"><h1>مدیریت خانه‌یار</h1>{bootError ? <><p className="mg-error" role="alert">{bootError}</p><button onClick={() => setRetry(value => value + 1)}>تلاش دوباره</button></> : <p role="status">در حال بررسی ورود…</p>}</main>;
  if (!session) return <LoginPage {...{ mode, ready, notice }} />;
  const props: Props = { refresh, role: session.role, act: operation => void act(operation), busy: preparing || Boolean(activeJob) };
  let content: ReactNode;
  switch (page) {
    case "overview": content = <OverviewPage {...props} />; break;
    case "analytics": content = <ProductAnalytics refresh={refresh} />; break;
    case "server": content = <ServerPage {...props} />; break;
    case "users": content = <UsersPage {...props} />; break;
    case "settings": content = <SettingsPage {...props} />; break;
    case "backups": content = <BackupsPage {...props} download={setDownload} />; break;
    case "releases": content = <ReleasesPage {...props} />; break;
    case "logs": content = <LogsPage {...props} />; break;
    case "accounts": content = <AccountsPage {...props} session={session} changed={() => setRefresh(value => value + 1)} />; break;
    case "history": content = <HistoryPage {...props} />; break;
  }
  return <main className="mg-app mg-shell" dir="rtl"><aside className="mg-sidebar"><div className="mg-brand"><img src={mark} width="44" height="44" alt="خانه‌یار" /><div><strong>مدیریت</strong><span>خانه‌یار</span></div></div><nav aria-label="بخش‌های مدیریت">{(Object.entries(pageLabels) as [Page, string][]).filter(([key]) => (key !== "accounts" || session.role === "owner") && (key !== "logs" || session.role !== "viewer")).map(([key, label]) => <button key={key} aria-current={page === key ? "page" : undefined} onClick={() => { setPage(key); setError(""); setNotice(""); }}><Icon page={key} />{label}</button>)}</nav><div className="mg-sidebar-footer"><strong><bdi dir="ltr">{session.username}</bdi></strong><span>{roleLabels[session.role]}</span><button disabled={preparing} onClick={() => void logout()}>خروج از پنل</button></div></aside><div className="mg-main">{mode === "demo" && <div className="mg-demo-banner"><strong>محیط آزمایشی محلی</strong><span>اطلاعات نمونه است؛ عملیات روی سرور واقعی اجرا نمی‌شود.</span></div>}<header className="mg-header"><div><span className="mg-muted">خانه‌یار / مدیریت سامانه</span><h1>{pageLabels[page]}</h1></div><button disabled={preparing} onClick={() => { setRefresh(value => value + 1); setError(""); }}>بررسی دوباره</button></header>{error && <div className="mg-notice mg-error" role="alert">{error}</div>}{notice && <div className="mg-notice" role="status">{notice}</div>}{preparing && <div className="mg-notice" role="status">در حال بررسی مقدمات عملیات…</div>}{activeJob && <div className="mg-notice mg-running" role="status"><span>{actionLabels[activeJob.operation.kind]} · {stateLabels[activeJob.status]}</span><button onClick={() => setPage("history")}>مشاهدهٔ سابقه</button></div>}<div key={session.username + page}>{content}</div><footer className="mg-footer">پنل مستقل مدیریت سرور و نرم‌افزار خانه‌یار</footer></div>{(plan || download) && <ConfirmDialog {...{ plan, download, session }} close={() => { setPlan(null); setDownload(null); }} done={job => { setPlan(null); setDownload(null); setNotice(job ? "درخواست ثبت شد؛ نتیجه در سابقهٔ عملیات نمایش داده می‌شود." : "فایل پشتیبان برای دریافت آماده شد."); if (job) setActiveJob(job); setRefresh(value => value + 1); }} />}</main>;
}
