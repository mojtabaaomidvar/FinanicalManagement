import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AppError } from "@/shared/lib/appError";
import { supportApi, type MembershipState, type RegistrationState, type SupportOverview,
  type SupportPage, type SupportTechnical, type SupportUsers } from "./api";
import type { SupportUsage as UsageData } from "./api";
import { SupportUsage } from "./SupportUsage";
import { supportPageTitle } from "./branding";
import "./support.css";

const pageLabels: Record<SupportPage, string> = { overview: "نمای کلی", users: "پیگیری کاربران", usage: "آمار استفاده", technical: "وضعیت فنی" };
const stageLabels: Record<SupportUsers["items"][number]["stage"], string> = {
  registration_required: "تکمیل ثبت‌نام", managed_profile: "پروفایل مدیریت‌شده", approval_pending: "تأیید عضویت", ready: "آمادهٔ ورود", inactive: "عضویت غیرفعال",
};
const attentionLabels: Record<NonNullable<SupportUsers["items"][number]["attention_reason"]>, string> = {
  registration_incomplete: "ثبت‌نام مستقل هنوز کامل نشده است.", managed_profile: "این پروفایل ثبت‌نام مستقل ندارد.",
  waiting_approval: "در انتظار تأیید مدیر خانواده است.", rejected: "درخواست عضویت رد شده است.", expired: "درخواست عضویت منقضی شده است.",
  suspended: "عضویت حساب تعلیق شده است.", removed: "عضویت حساب پایان یافته است.",
};
const registrationLabels: Record<RegistrationState, string> = {
  registered: "ثبت‌نام کامل", introduced: "معرفی‌شده؛ ثبت‌نام ناتمام", managed: "پروفایل مدیریت‌شده",
};
const membershipLabels: Record<MembershipState, string> = {
  active: "فعال", pending: "در انتظار تأیید", rejected: "ردشده", expired: "منقضی‌شده", suspended: "تعلیق‌شده", removed: "حذف‌شده",
};
const count = (n: number) => n.toLocaleString("fa-IR");
const date = (value: string) => new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium", timeZone: "Asia/Tehran",
}).format(new Date(value.length === 10 ? value + "T12:00:00+03:30" : value));
const time = (value: string) => new Intl.DateTimeFormat("fa-IR", {
  hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tehran",
}).format(new Date(value));

function Failure({ message, retry }: { message: string; retry: () => void }) {
  return <div className="support-state" role="alert"><p>{message}</p><button onClick={retry}>تلاش دوباره</button></div>;
}
function Loading() {
  return <div className="support-state" role="status"><span className="support-loader" aria-hidden="true" />در حال دریافت وضعیت…</div>;
}
function Metric({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return <div className={`support-metric${accent ? " support-metric-accent" : ""}`}><span>{label}</span><strong>{count(value)}</strong></div>;
}
function CopyCode({ value }: { value: string }) {
  const [message, setMessage] = useState("");
  return <div className="support-code"><code dir="ltr">{value}</code><button
    aria-label="کپی کد پشتیبانی" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setMessage("کد پشتیبانی کپی شد."); }
      catch { setMessage("کپی انجام نشد؛ کد نمایش‌داده‌شده را انتخاب و کپی کنید."); }
    }}>کپی</button>{message && <small role="status">{message}</small>}</div>;
}

export function SupportPanel() {
  const [phase, setPhase] = useState<"checking" | "login" | "ready" | "disabled">("checking");
  const [page, setPage] = useState<SupportPage>("overview");
  const [sessionError, setSessionError] = useState("");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [refresh, setRefresh] = useState(0);
  const [days, setDays] = useState(7);
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [membership, setMembership] = useState("all");
  const [registration, setRegistration] = useState("all");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ page: SupportPage; value: SupportOverview | SupportUsers | SupportTechnical | UsageData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const previous = document.title; document.title = supportPageTitle;
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    let current = true;
    setSessionError(""); setPhase("checking");
    void supportApi.session().then(result => {
      if (current) setPhase(result.authenticated ? "ready" : "login");
    }).catch((e: unknown) => {
      if (!current) return;
      if (e instanceof AppError && e.serverCode === "SUPPORT_DISABLED") setPhase("disabled");
      else setSessionError(e instanceof Error ? e.message : "بررسی ورود انجام نشد.");
    });
    return () => { current = false; };
  }, [sessionRetry]);

  useEffect(() => {
    if (phase !== "ready") { setData(null); return; }
    let current = true;
    setLoading(true); setError(""); setData(null);
    const pending = page === "overview" ? supportApi.overview(days)
      : page === "technical" ? supportApi.technical()
      : page === "usage" ? supportApi.usage(days)
      : supportApi.users({ code, membership, registration, offset });
    void pending.then(value => { if (current) setData({ page, value }); }).catch((e: unknown) => {
      if (!current) return;
      if (e instanceof AppError && e.serverCode === "SUPPORT_UNAUTHORIZED") {
        setPhase("login"); setPassword(""); setSessionError("نشست پشتیبانی پایان یافته است. دوباره وارد شوید.");
      } else if (e instanceof AppError && e.serverCode === "SUPPORT_DISABLED") setPhase("disabled");
      else setError(e instanceof Error ? e.message : "دریافت اطلاعات پنل انجام نشد.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [phase, page, refresh, days, code, membership, registration, offset]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setSessionError("");
    try {
      const result = await supportApi.login(username.trim(), password);
      if (result.authenticated) { setPassword(""); setPhase("ready"); setPage("overview"); }
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : "ورود به پنل انجام نشد.");
    } finally { lock.current = false; setBusy(false); }
  }
  async function logout() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await supportApi.logout(); setData(null); setPassword(""); setUsername("");
      setSearch(""); setCode(""); setOffset(0); setPhase("login");
    } catch (e) { setError(e instanceof Error ? e.message : "خروج انجام نشد. دوباره تلاش کنید."); }
    finally { lock.current = false; setBusy(false); }
  }

  const brand = <div className="support-brand"><img src="/support-mark.svg" alt="پشتیبانی" /><div><strong>پشتیبانی</strong><span>خانه‌یار</span></div></div>;
  if (phase !== "ready") return <main className="support-shell support-auth" dir="rtl">
    <div className="support-auth-card">{brand}<h1>ورود پشتیبانی</h1>
      <p>پیگیری ثبت‌نام و وضعیت نرم‌افزار</p>
      {phase === "checking" ? sessionError
        ? <Failure message={sessionError} retry={() => setSessionRetry(n => n+1)} /> : <Loading />
        : phase === "disabled" ? <div className="support-state"><p>ورود پشتیبانی هنوز فعال نشده است.</p>
          <button onClick={() => setSessionRetry(n => n+1)}>بررسی دوباره</button></div>
        : <form onSubmit={login}>
          <label>نام کاربری پشتیبانی<input name="username" autoComplete="username" value={username} disabled={busy}
            onChange={e => setUsername(e.target.value)} required maxLength={64} dir="ltr" /></label>
          <label>رمز پشتیبانی<input name="password" type="password" autoComplete="current-password" value={password}
            onChange={e => setPassword(e.target.value)} disabled={busy} required maxLength={128} dir="ltr" /></label>
          {sessionError && <p role="alert" className="support-error">{sessionError}</p>}
          <button className="support-primary" disabled={busy}>{busy ? "در حال ورود…" : "ورود به پنل"}</button>
        </form>}
      <div className="support-auth-note">دسترسی مخصوص پشتیبانی نرم‌افزار</div>
    </div>
  </main>;

  let content: ReactNode = null;
  if (data?.page === page && page === "overview") {
    const overview = data.value as SupportOverview;
    const max = Math.max(1, ...overview.daily.map(d => d.registrations));
    content = <><div className="support-metrics">
      <Metric label="ثبت‌نام کامل" value={overview.registered} accent />
      <Metric label="در انتظار تأیید عضویت" value={overview.awaiting_approval} />
      <Metric label="عضویت فعال" value={overview.active} />
    </div><section className="support-section">
      <div className="support-section-heading"><div><h2>حساب‌های ایجادشده</h2><p>حساب‌های این بازه که ثبت‌نامشان کامل است</p></div>
        <label className="support-period">بازه<select value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>۷ روز اخیر</option><option value={30}>۳۰ روز اخیر</option></select></label></div>
      <div className="support-trend-total"><strong>{count(overview.new_registrations)}</strong><span>حساب جدید</span></div>
      <ol className="support-chart" aria-label="حساب‌های جدید به تفکیک روز" style={{ gridTemplateColumns: `repeat(${days}, minmax(20px, 1fr))` }}>
        {overview.daily.map(day => <li key={day.day} title={`${date(day.day)}: ${count(day.registrations)}`}>
          <span>{count(day.registrations)}</span><div className="support-chart-track"><i style={{ height: `${day.registrations / max * 100}%` }} /></div>
          <small>{new Intl.DateTimeFormat("fa-IR", { day: "numeric", timeZone: "Asia/Tehran" }).format(new Date(day.day + "T12:00:00+03:30"))}</small></li>)}</ol>
      {!overview.new_registrations && <p className="support-caption">در این بازه حساب تازه‌ای با ثبت‌نام کامل وجود ندارد.</p>}
    </section><div className="support-secondary-metrics"><Metric label="معرفی‌شده؛ ثبت‌نام ناتمام" value={overview.introduced} />
      <Metric label="پروفایل مدیریت‌شده" value={overview.managed} /></div>
      <p className="support-caption">پروفایل‌های مدیریت‌شده، مثل پروفایل ساخته‌شده برای فرزند، ثبت‌نام مستقل محسوب نمی‌شوند.</p>
      <p className="support-updated">آخرین بررسی: {date(overview.checked_at)}، {time(overview.checked_at)}</p></>;
  } else if (data?.page === page && page === "users") {
    const users = data.value as SupportUsers;
    content = <section className="support-section support-user-list">
      <div className="support-section-heading"><h2>وضعیت کاربران</h2><span>{count(users.total)} مورد</span></div>
      {!users.items.length ? <div className="support-state"><p>موردی با این کد یا فیلترها پیدا نشد.</p>
        <p>کد پشتیبانی را از خود کاربر بگیرید یا فیلترها را تغییر دهید.</p></div>
        : <div className="support-table-scroll"><table><thead><tr><th>کد پشتیبانی</th><th>تاریخ ایجاد</th><th>ثبت‌نام</th><th>عضویت</th><th>تکمیل ثبت‌نام</th><th>آخرین ورود موفق</th><th>مرحله و علت پیگیری</th></tr></thead>
          <tbody>{users.items.map(user => <tr key={user.support_code}><td><CopyCode value={user.support_code} /></td>
            <td>{date(user.created_at)}</td><td>{registrationLabels[user.registration_state]}</td><td>
              <span className={`support-badge support-badge-${user.membership_state}`}>{membershipLabels[user.membership_state]}</span></td>
            <td>{user.registered_at ? <time dateTime={user.registered_at}>{date(user.registered_at)}، {time(user.registered_at)}</time>
              : user.registration_state === "registered" ? <span className="support-caption">سابقهٔ این زمان ثبت نشده</span> : <span className="support-caption">تکمیل نشده</span>}</td>
            <td>{user.last_login_at ? <time dateTime={user.last_login_at}>{date(user.last_login_at)}، {time(user.last_login_at)}</time>
              : <span className="support-caption">سابقهٔ این زمان ثبت نشده</span>}</td>
            <td className="support-stage"><strong>{stageLabels[user.stage]}</strong><small>{user.attention_reason
              ? attentionLabels[user.attention_reason] : <>مانعی در وضعیت عضویت ثبت نشده است.</>}</small></td></tr>)}</tbody></table></div>}
      <div className="support-pagination"><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0,n-25))}>قبلی</button>
        <span>صفحهٔ {count(Math.floor(offset/25)+1)}</span><button disabled={offset+users.items.length >= users.total}
          onClick={() => setOffset(n => n+25)}>بعدی</button></div>
    </section>;
  } else if (data?.page === page && page === "usage") {
    content = <SupportUsage data={data.value as UsageData} days={days} onDaysChange={setDays} />;
  } else if (data?.page === page && page === "technical") {
    const technical = data.value as SupportTechnical;
    content = <><section className="support-section"><div className="support-section-heading"><div><h2>وضعیت سرویس‌ها</h2><p>وضعیت بررسی‌شده در همین درخواست</p></div>
      <span className="support-live">بررسی شد</span></div><dl className="support-services">
        <div><dt>سرویس برنامه</dt><dd>در دسترس</dd></div><div><dt>پایگاه داده</dt><dd>در دسترس</dd></div>
        <div><dt>ارسال پیامک</dt><dd>{technical.sms === "configured" ? "پیکربندی‌شده" : "غیرفعال"}</dd></div></dl></section>
      <section className="support-section"><div className="support-section-heading"><div><h2>خطاهای ثبت‌شدهٔ اخیر</h2><p>خطاهای ورود و ثبت‌نام در ۲۴ بازهٔ ساعتی اخیر</p></div></div>
        <div className="support-metrics"><Metric label="خطای ورود" value={technical.login_errors} />
          <Metric label="خطای ثبت‌نام" value={technical.registration_errors} /><Metric label="خطای سرور" value={technical.server_errors} /></div>
        <p className="support-caption">شمارش خطاها از فعال‌شدن این نسخه آغاز شده است.</p></section>
      <p className="support-updated">آخرین بررسی: {date(technical.checked_at)}، {time(technical.checked_at)}</p></>;
  }

  return <main className="support-shell" dir="rtl"><aside className="support-sidebar">{brand}
    <nav aria-label="بخش‌های پشتیبانی">{(Object.keys(pageLabels) as SupportPage[]).map(key => <button key={key}
      aria-current={page === key ? "page" : undefined} onClick={() => setPage(key)}>{pageLabels[key]}</button>)}</nav>
    <div className="support-sidebar-footer"><span>دسترسی فقط برای مشاهده</span><button disabled={busy} onClick={() => void logout()}>
      {busy ? "در حال خروج…" : "خروج از پنل"}</button></div></aside>
    <div className="support-main"><header className="support-header"><h1>{pageLabels[page]}</h1>
      <button className="support-refresh" disabled={loading || busy} onClick={() => setRefresh(n => n+1)}>به‌روزرسانی</button></header>
      {page === "users" && <div className="support-filters"><form onSubmit={event => { event.preventDefault(); setCode(search.trim()); setOffset(0); setRefresh(n => n+1); }}>
        <label>کد پشتیبانی<input dir="ltr" value={search} onChange={e => setSearch(e.target.value)} maxLength={64} placeholder="کد دریافتی از کاربر" /></label>
        <button className="support-primary">جست‌وجو</button></form>
        <label>ثبت‌نام<select value={registration} onChange={e => {setRegistration(e.target.value);setOffset(0);}}>
          <option value="all">همهٔ وضعیت‌ها</option>{Object.entries(registrationLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>عضویت<select value={membership} onChange={e => {setMembership(e.target.value);setOffset(0);}}>
          <option value="all">همهٔ وضعیت‌ها</option>{Object.entries(membershipLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}
      {error ? <Failure message={error} retry={() => {setError("");setRefresh(n => n+1);}} /> : loading ? <Loading /> : content}
    </div></main>;
}
