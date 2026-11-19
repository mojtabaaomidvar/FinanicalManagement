import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* خانه: بیلبورد → دسترسی شخصی → موعدهای واقعی؛ بخش‌ها در صفحهٔ جدا.
   دادهٔ آنلاین از snapshot مجاز همان نشست می‌آید؛ دادهٔ آفلاین محدود است. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { formatAmount, formatSignedAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import { accountBalances, monthTotals, totalCashBalance } from "@/domain/report/report.rules";
import { monthCategorySpend } from "@/domain/budget/budget.rules";
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
import { HomeBillboard } from "./HomeBillboard";
import type { TxType } from "@/domain/transaction/transaction.types";
import { HomeModules } from "./HomeModules";
import { useHomePreferences } from "./useHomePreferences";
import { useHomeToday } from "./useHomeToday";
import "./HubPage.css";

export function HubPage({
  onNav,
  onAddTransaction,
  summary,
  onOpenItem,
  onRetry,
  view = "dashboard",
}: {
  onNav: (r: Route) => void;
  onAddTransaction: (type: TxType) => void;
  summary: Pick<NotificationsModel, "documents" | "equipment" | "vehicles" | "goals" | "activities" | "onlineSummaryState">;
  onOpenItem: (ref: NotificationRef) => void;
  onRetry: () => void;
  view?: "dashboard" | "sections";
}) {
  const {
    member,
    family,
    members,
    txs,
    accounts,
    budgets,
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
    const unpaid = bills.filter((b) => b.state === "unpaid");
    const walletBalances = accountBalances(txs, accounts.filter(account => account.memberId === member?.id && account.kind === "wallet"));
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

    return {
      monthCount: monthTxs.length,
      monthExpense: totals.expense,
      balance: totalCashBalance(txs, accounts),
      wallets: { count: walletBalances.length, balance: walletBalances.reduce((sum, row) => sum + row.balance, 0) },
      budget: { limit: budgets.reduce((sum, budget) => sum + budget.amount, 0),
        spent: budgets.reduce((sum, budget) => sum + (spend.get(budget.category) ?? 0), 0) },
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
  }, [txs, accounts, budgets, bills, events, shoppingLists, inventory, todayIso, member?.id]);

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

  const initial = (member?.name ?? "؟").trim().charAt(0);

  return (
    <section className={`page active hub-page${view === "sections" ? " home-sections-page" : ""}`}>
      <header className="hub-head">
        <div className="hub-id">
          <h1>{view === "sections" ? "بخش‌های خانه" : family?.name ?? "خانه‌ی من"}</h1>
          <p>
            {members.length ? `${toFa(members.length)} عضو` : "خانه‌ی شما"}
            {member ? ` · ${member.name}` : ""}
          </p>
        </div>
        <div className="hub-head-actions">
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

      {view === "dashboard" ? <HomeBillboard wallets={stats.wallets} budget={stats.budget}
        dues={{ overdue: overview.overdue.length, today: overview.today.length, upcoming: overview.upcoming.length }}
        currency={cur} loading={loading} incomplete={incomplete} offline={restricted}
        onTransaction={onAddTransaction} onAccounts={() => onNav("accounts")} onBudgets={() => onNav("budgets")}
        onRetry={onRetry} onDues={() => {
          const title = document.getElementById("home-overview-title");
          title?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          title?.focus({ preventScroll: true });
        }} /> : null}

      <HomeModules key={`${family?.id}:${member?.id}`} preferences={homePreferences.preferences}
        onChange={homePreferences.changePreferences} disabled={!homePreferences.ready}
        view={view} subtitle={subtitle} onNav={onNav}
        saving={homePreferences.saving} pending={homePreferences.pending} conflict={homePreferences.conflict}
        error={homePreferences.error} restricted={restricted} onRetry={homePreferences.retry}>
      <HomeOverview overview={overview} data={overviewData} todayIso={todayIso} loading={loading}
        incomplete={incomplete} offline={restricted} onOpen={onOpenItem} onRetry={onRetry} />

      </HomeModules>

      {view === "sections" && SOON_MODULES.length ? <><h2 className="hub-section">
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
