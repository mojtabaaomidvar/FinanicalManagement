import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* خانه: دسترسی شخصی → موعدهای واقعی → دسته‌های قابل جابه‌جایی.
   دادهٔ آنلاین از snapshot مجاز همان نشست می‌آید؛ دادهٔ آفلاین محدود است. */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount, formatSignedAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { monthTotals, totalCashBalance } from "@/domain/report/report.rules";
import { monthCategorySpend, budgetStatus } from "@/domain/budget/budget.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { findDollar } from "@/domain/market/market.rules";
import { lowItems, totalPending } from "@/domain/shopping/shopping.rules";
import { useMarket } from "@/features/market";
import { cmp, isoToJalali, jalaliToIso } from "@/shared/lib/jalali";
import { deriveHomeOverview } from "@/domain/home/homeOverview.rules";
import type { NotificationRef } from "@/domain/notification/notification.types";
import type { NotificationsModel } from "@/features/notifications/model/useNotificationsModel";
import { useOnline } from "@/shared/lib/useOnline";
import type { Route } from "@/app/router";
import { SOON_MODULES, type HubModule } from "./modules";
import { HomeOverview } from "./HomeOverview";
import { HomeModules } from "./HomeModules";
import { useHomePreferences } from "./useHomePreferences";
import { useHomeToday } from "./useHomeToday";
import "./HubPage.css";

type Banner = {
  id: string;
  title: string;
  desc: string;
  icon?: string;
  tone: string;
  cta: string;
  route: Route;
};

export function HubPage({
  onNav,
  onAddTransaction,
  bell,
  summary,
  onOpenItem,
  onRetry,
}: {
  onNav: (r: Route) => void;
  onAddTransaction: () => void;
  /* زنگِ اعلان — به‌صورتِ نود تزریق می‌شود نه ساخته‌شده در همین صفحه.
     دلیل: مرکزِ اعلان به TxFormModel و به ناوبریِ زیرصفحهٔ تنظیمات نیاز
     دارد و هر دو در MainShell زندگی می‌کنند؛ ساختنش این‌جا یعنی کشیدنِ آن
     دو تا داخلِ صفحه‌ای که کارش فقط کاشی‌هاست. */
  bell?: ReactNode;
  summary: Pick<NotificationsModel, "documents" | "equipment" | "vehicles" | "goals" | "activities" | "onlineSummaryState">;
  onOpenItem: (ref: NotificationRef) => void;
  onRetry: () => void;
}) {
  const {
    member,
    family,
    members,
    txs,
    accounts,
    budgets,
    customCategories,
    cur,
    bills,
    events,
    shoppingLists,
    inventory,
    tasks,
    shoppingSync,
    offlineSession,
    homeDataStatus,
    useCases,
  } = useApp();
  const online = useOnline();
  const restricted = !online || shoppingSync.offline || offlineSession;
  const homePreferences = useHomePreferences({ memberId: member?.id, familyId: family?.id, useCases, restricted });
  const { todayIso, todayJ } = useHomeToday();
  const overviewData = {
    bills: restricted ? [] : bills,
    events: restricted ? [] : events,
    tasks,
    equipment: restricted ? [] : summary.equipment,
    vehicles: restricted ? [] : summary.vehicles,
    goals: restricted ? [] : summary.goals.filter((row) => row.ownerId === member?.id),
    activities: restricted ? [] : summary.activities,
    memberId: member?.id,
    role: member?.role ?? "member",
    todayJ,
  };
  const overview = deriveHomeOverview(overviewData);
  const summaryLoading = !restricted && Boolean(summary.onlineSummaryState?.loading);
  const incomplete = homeDataStatus.incomplete || (!restricted && Boolean(summary.onlineSummaryState?.failedSources.length));
  const loading = homeDataStatus.loading || summaryLoading;

  /* قیمت لحظه‌ای دلار برای زیرنویس کاشی بازار — با صفحه‌ی بازار کش مشترک دارد */
  const market = useMarket();
  const usd = market.data ? findDollar(market.data.currency) : null;

  /* ارقام زنده‌ی همین ماه — یک‌بار حساب می‌شوند و بین زیرنویس‌ها و بنرها مشترک‌اند */
  const stats = useMemo(() => {
    const now = todayJ;
    const [jy, jm] = now;
    const monthTxs = txsInJalaliMonth(txs, jy, jm);
    const totals = monthTotals(monthTxs);
    const spend = monthCategorySpend(txs, jy, jm);
    const resolve = buildCategoryResolver(customCategories);
    const unpaid = bills.filter((b) => b.state === "unpaid");
    /* نزدیک‌ترین رویداد معتبر؛ برنامهٔ انجام‌شده یا لغوشده در خلاصه نمی‌آید. */
    const nextEv = events.filter((e) => (e.kind !== "activity" || e.activityStatus === "planned")
      && cmp(isoToJalali(e.date), now) >= 0).sort((a, b) => a.date.localeCompare(b.date))[0];
    /* فاصله را روی تاریخِ **میلادی** حساب می‌کنیم چون `FamilyEvent.date`
       همان است و تفریقِ روزِ میلادی بی‌دردسر است؛ تبدیل به جلالی فقط برای
       مقایسهٔ «گذشته یا آینده» لازم بود. */
    const nextEventDays = nextEv
      ? Math.round(
          (Date.parse(nextEv.date) - Date.parse(jalaliToIso(now))) / 86400000,
        )
      : 0;

    let overBudget: string | null = null;
    let warnBudget: string | null = null;
    for (const b of budgets) {
      const st = budgetStatus(b.amount, spend.get(b.category) ?? 0);
      if (st.level === "over" && !overBudget)
        overBudget = resolve(b.category).name;
      else if (st.level === "warn" && !warnBudget)
        warnBudget = resolve(b.category).name;
    }

    return {
      monthCount: monthTxs.length,
      monthExpense: totals.expense,
      balance: totalCashBalance(txs, accounts),
      overBudget,
      warnBudget,
      unpaidBills: unpaid.length,
      unpaidTotal: unpaid.reduce((s, b) => s + b.amount, 0),
      nextEvent: nextEv?.title ?? null,
      nextEventDays,
      /* §۱.۸ — اقلامِ نخریده در همهٔ لیست‌ها، و اقلامِ زیرِ آستانهٔ انبار */
      shoppingPending: totalPending(shoppingLists),
      shoppingLists: shoppingLists.length,
      lowStock: lowItems(inventory).length,
      stockCount: inventory.length,
    };
  }, [txs, accounts, budgets, customCategories, bills, events, shoppingLists, inventory, todayIso]);

  const money = (n: number) => `${formatSignedAmount(toDisplay(n, cur))} ${currencyDisplayLabel(cur)}`;

  /* زیرنویس زنده‌ی هر کاشی فعال */
  const liveSub: Record<string, string> = {
    finance: `خرج این ماه ${money(stats.monthExpense)}`,
    transactions: stats.monthCount
      ? `${toFa(stats.monthCount)} تراکنش در این ماه`
      : "هنوز تراکنشی ثبت نشده",
    accounts: accounts.length
      ? `${toFa(accounts.length)} حساب · ${money(stats.balance)}`
      : "حساب یا کارت اضافه کن",
    budgets: budgets.length
      ? `${toFa(budgets.length)} بودجه‌ی فعال`
      : "هنوز بودجه‌ای نداری",
    market: usd
      ? `دلار ${formatAmount(usd.price)} ${usd.unit}`
      : market.loading
        ? "در حال دریافت قیمت‌ها…"
        : "قیمت‌ها موقتاً در دسترس نیست",
    /* §۱.۹ — زیرنویسِ واقعی، نه تزئینی: اگر بدهی هست مبلغش را می‌گوید.
       همان قاعدهٔ بقیهٔ کاشی‌ها. */
    bills: stats.unpaidBills
      ? `${toFa(stats.unpaidBills)} قبض · ${money(stats.unpaidTotal)}`
      : "قبض پرداخت‌نشده‌ای نداری",
    /* §۱.۱۰ — نزدیک‌ترین رویداد، نه شمارشِ خشک: «۳ رویداد» چیزی نمی‌گوید،
       «تولد نسیم ۵ روز دیگر» می‌گوید. */
    calendar: stats.nextEvent
      ? stats.nextEventDays === 0
        ? `${stats.nextEvent} — امروز`
        : `${stats.nextEvent} — ${toFa(stats.nextEventDays)} روز دیگر`
      : "رویداد نزدیکی نداری",
    /* §۱.۸ — کارِ باقی‌مانده، نه شمارشِ لیست‌ها: «۲ لیست» چیزی نمی‌گوید،
       «۷ قلم مانده» می‌گوید. */
    shopping: stats.shoppingPending
      ? `${toFa(stats.shoppingPending)} قلم مانده`
      : stats.shoppingLists
        ? "لیست‌ها خالی‌اند"
        : "اولین لیست را بساز",
    inventory: stats.lowStock
      ? `${toFa(stats.lowStock)} قلم دارد تمام می‌شود`
      : stats.stockCount
        ? `${toFa(stats.stockCount)} قلم · همه به‌اندازه`
        : "انبار خانه را بچین",
    reports: "نمودار و گزارش ماهانه",
    chores: tasks.some((task) => !task.completed)
      ? `${toFa(tasks.filter((task) => !task.completed).length)} کار مانده`
      : "کاری برای انجام‌دادن نمانده",
    docs: summary.documents.length ? `${toFa(summary.documents.length)} سند در دسترس` : "ثبت و مدیریت اسناد خانه",
    equipment: summary.equipment.length ? `${toFa(summary.equipment.length)} وسیلهٔ ثبت‌شده` : "ثبت وسیله و موعد سرویس",
    vehicles: summary.vehicles.length ? `${toFa(summary.vehicles.length)} خودروی ثبت‌شده` : "ثبت خودرو و موعد سرویس",
    goals: overviewData.goals.length ? `${toFa(overviewData.goals.filter((row) => row.status === "active").length)} هدف و آرزوی فعال من` : "هدف‌ها و آرزوهای شخصی من",
    activities: summary.activities.length ? `${toFa(summary.activities.filter((row) => row.status === "planned").length)} برنامهٔ پیش رو` : "ثبت برنامهٔ خانوادگی",
  };
  const subtitle = (module: HubModule): string | undefined => {
    if (restricted && !["chores", "shopping", "inventory"].includes(module.id)) return "نیاز به اتصال اینترنت";
    const source = module.id === "docs" ? "documents" : module.id;
    if (["documents", "equipment", "vehicles", "goals", "activities"].includes(source)) {
      if (summaryLoading) return "در حال دریافت اطلاعات…";
      if (summary.onlineSummaryState?.failedSources.some((failed) => failed === source)) return "اطلاعات این بخش دریافت نشد";
    }
    return liveSub[module.id] ?? module.sub;
  };

  /* بنرها — فقط وقتی واقعاً موضوعی هست؛ هیچ‌کدام تزئینی نیست */
  const banners = useMemo<Banner[]>(() => {
    if (restricted || loading || incomplete) return [];
    const list: Banner[] = [];
    if (members.length < 2) {
      list.push({
        id: "invite",
        title: "خانواده‌ات را دعوت کن",
        desc: "با هم ثبت کنید تا تصویر کامل خرج خانه را ببینید.",
        icon: "i-users",
        tone: "indigo",
        cta: "دعوت از اعضا",
        route: "settings",
      });
    }
    if (!accounts.length) {
      list.push({
        id: "account",
        title: "اولین حساب را بساز",
        desc: "کارت یا کیف پولت را اضافه کن تا موجودی درست حساب شود.",
        icon: "i-wallet",
        tone: "emerald",
        cta: "افزودن حساب",
        route: "accounts",
      });
    }
    if (stats.overBudget) {
      list.push({
        id: "over",
        title: `بودجه‌ی ${stats.overBudget} تمام شد`,
        desc: "مصرف این ماه از سقفی که گذاشته‌ای بیشتر شده است.",
        icon: "i-alert",
        tone: "rose",
        cta: /* @copy-text src/pages/HubPage/HubPage.tsx:108:typescript-string */ "بودجه‌ها",
        route: "budgets",
      });
    } else if (stats.warnBudget) {
      list.push({
        id: "warn",
        title: `بودجه‌ی ${stats.warnBudget} نزدیک سقف`,
        desc: "بیش از ۸۰٪ بودجه‌ی این ماه مصرف شده است.",
        icon: "i-piggy",
        tone: "amber",
        cta: /* @copy-text src/pages/HubPage/HubPage.tsx:115:typescript-string */ "بودجه‌ها",
        route: "budgets",
      });
    }
    if (!budgets.length) {
      list.push({
        id: "budget",
        title: "برای خرج ماه سقف بگذار",
        desc: "بودجه‌ی دسته‌ها را تعیین کن تا جلوی خرج اضافه گرفته شود.",
        icon: "i-piggy",
        tone: "amber",
        cta: "ساختن بودجه",
        route: "budgets",
      });
    }
    return list.slice(0, 3);
  }, [members.length, accounts.length, budgets.length, stats, restricted, loading, incomplete]);

  /* نقطه‌های کاروسل — در RTL مقدار scrollLeft منفی می‌شود، پس قدرمطلق */
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [slide, setSlide] = useState(0);
  function onStripScroll() {
    const el = stripRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    setSlide(Math.max(0, Math.min(i, banners.length - 1)));
  }

  const initial = (member?.name ?? "؟").trim().charAt(0);

  return (
    <section className="page active hub-page">
      <header className="hub-head">
        <div className="hub-id">
          <h1>{family?.name ?? "خانه‌ی من"}</h1>
          <p>
            {members.length ? `${toFa(members.length)} عضو` : "خانه‌ی شما"}
            {member ? ` · ${member.name}` : ""}
          </p>
        </div>
        <div className="hub-head-actions">
          {bell}
          <button
            type="button"
            className="hub-avatar"
            aria-label="پروفایل و تنظیمات"
            title="پروفایل و تنظیمات"
            onClick={() => onNav("settings")}
          >
            <ProfileAvatar key={`${member?.id}:${member?.avatarUrl ?? ""}`} url={member?.avatarUrl} initial={initial} />
          </button>
        </div>
      </header>

      <HomeModules key={`${family?.id}:${member?.id}`} preferences={homePreferences.preferences}
        onChange={homePreferences.changePreferences} disabled={!homePreferences.ready}
        lifecycleKey={`${member?.id}:${restricted}`} subtitle={subtitle} onNav={onNav}
        saving={homePreferences.saving} pending={homePreferences.pending} conflict={homePreferences.conflict}
        error={homePreferences.error} restricted={restricted} onRetry={homePreferences.retry} onReset={homePreferences.resetPreferences}>
      <HomeOverview overview={overview} data={overviewData} todayIso={todayIso} loading={loading}
        incomplete={incomplete} offline={restricted} onOpen={onOpenItem} onRetry={onRetry} />

      {banners.length ? (
        <div className="hub-banners">
          <div className="hub-strip" ref={stripRef} onScroll={onStripScroll}>
            {banners.map((b) => (
              <article key={b.id} className={`hub-banner tone-${b.tone}`}>
                {b.icon ? <span className="hub-banner-ic" aria-hidden="true">
                  <Icon name={b.icon} size={24} />
                </span> : null}
                <div className="hub-banner-txt">
                  <b>{b.title}</b>
                  <span>{b.desc}</span>
                </div>
                <button
                  type="button"
                  className="hub-banner-cta"
                  onClick={() => onNav(b.route)}
                >
                  {b.cta}
                  <Icon name="i-arrow-l" size={16} />
                </button>
              </article>
            ))}
          </div>
          {banners.length > 1 ? (
            <div className="hub-dots" aria-hidden="true">
              {banners.map((b, i) => (
                <span
                  key={b.id}
                  className={`hub-dot${i === slide ? " active" : ""}`}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {!restricted ? <button type="button" className="hub-add" onClick={onAddTransaction}>
        <span className="hub-add-ic" aria-hidden="true">
          <Icon name="i-plus" size={20} />
        </span>
        <span className="hub-add-txt">
          <b>ثبت خرج یا درآمد</b>
          <span>سریع‌ترین راه برای ثبت یک تراکنش</span>
        </span>
      </button> : null}

      </HomeModules>

      {SOON_MODULES.length ? <><h2 className="hub-section">
        به‌زودی
        <span className="hub-section-note">در حال ساخت</span>
      </h2>
      <div className="hub-grid">
        {SOON_MODULES.map((m) => (
          <Tile key={m.id} m={m} soon />
        ))}
      </div></> : null}
    </section>
  );
}

function ProfileAvatar({ url, initial }: { url?: string | null; initial: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed
    ? <img src={url} alt="" onError={() => setFailed(true)} />
    : <span aria-hidden="true">{initial}</span>;
}

function Tile({
  m,
  sub,
  soon,
  onNav,
}: {
  m: HubModule;
  sub?: string;
  soon?: boolean;
  onNav?: (r: Route) => void;
}) {
  if (soon || !m.route) {
    return (
      <div className="hub-tile is-soon" aria-disabled="true">
        <div className="hub-tile-top">
          <b className="hub-tile-title">{m.title}</b>
          {m.icon ? <span className="hub-tile-ic" aria-hidden="true">
            <Icon name={m.icon} size={22} />
          </span> : null}
        </div>
        <span className="hub-soon-badge">به‌زودی</span>
      </div>
    );
  }

  const route = m.route;
  return (
    <button
      type="button"
      className={`hub-tile tone-${m.tone}`}
      data-home-module={m.id}
      onClick={() => onNav?.(route)}
    >
      <div className="hub-tile-top">
        <b className="hub-tile-title">{m.title}</b>
        {m.icon ? <span className="hub-tile-ic" aria-hidden="true">
          <Icon name={m.icon} size={22} />
        </span> : null}
      </div>
      {sub ? <span className="hub-tile-sub">{sub}</span> : null}
    </button>
  );
}
