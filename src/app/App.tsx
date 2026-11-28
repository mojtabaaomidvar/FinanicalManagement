/* ریشه اپ — ناوبری، لینک دعوت، تب‌بار، پیامک‌های pending */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./providers/AppProvider";
import { requestBack } from "@/shared/lib/backGuard";
import { useNavigation } from "./useNavigation";
import { useMobileViewport } from "./useMobileViewport";
import type { QuickAddKind } from "@/widgets/quick-actions/FloatingNavigation";
import { PageActivityContext } from "@/shared/lib/pageActivity";
import { PageNavigationContext } from "@/shared/ui/AppPage";
import { FloatingNavigation } from "@/widgets/quick-actions/FloatingNavigation";
import { useNativeSmsReader } from "./useNativeSmsReader";
import { useTheme } from "./providers/useTheme";
import { MAIN_ROUTES, type Route } from "./router";
import { recordUsageOpen } from "@/features/support/trackUsage";
import { PwaUpdateProvider, usePwaUpdateState } from "./pwaUpdate.tsx";
import {
  AuthFeature,
  InviteAcceptFeature,
  type AuthPrefill,
} from "@/features/auth";
import {
  OnboardingFeature,
  isIntroSeen,
  markIntroSeen,
  useApplyIntroDraft,
} from "@/features/onboarding";
import {
  TransactionFormFeature,
  useTxFormModel,
} from "@/features/transaction-form";
import { PendingSmsFeature } from "@/features/pending-sms";
import { usePendingSmsModel } from "@/features/pending-sms/model/usePendingSmsModel";
import { SmsPage } from "@/pages/SmsPage/SmsPage";
import {
  InstallPromptFeature,
  useInstallPrompt,
} from "@/features/install-prompt";
import {
  NotificationCenterFeature,
  useNotificationsModel,
} from "@/features/notifications";
import { DashboardPage } from "@/pages/DashboardPage";
import { HubPage } from "@/pages/HubPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { BudgetsPage } from "@/pages/BudgetsPage";
import { BillsPage } from "@/pages/BillsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { ShoppingPage } from "@/pages/ShoppingPage";
import { InventoryPage } from "@/pages/InventoryPage";
import { TasksPage } from "@/pages/TasksPage";
import { DocumentsPage } from "@/pages/DocumentsPage";
import { MealsPage } from "@/pages/MealsPage";
import { EquipmentPage } from "@/pages/EquipmentPage";
import { VehiclesPage } from "@/pages/VehiclesPage";
import { GoalsPage } from "@/pages/GoalsPage";
import { ActivitiesPage } from "@/pages/ActivitiesPage";
import { ChildrenPage } from "@/pages/ChildrenPage";
import { PetsPage } from "@/pages/PetsPage";
import { MarketPage } from "@/pages/MarketPage";
import { SettingsPage, type SettingsSection } from "@/pages/SettingsPage";
import { OfflineBar } from "@/shared/ui";
import { useToast } from "./providers/ToastProvider";
import { DevPanel, type DevOverride } from "./dev/DevPanel";
import { useOnline } from "@/shared/lib/useOnline";
import type { NotificationRef } from "@/domain/notification/notification.types";
import { useHouseholdAssistant } from "@/features/household-assistant/model/useHouseholdAssistant";
import { HouseholdAssistant } from "@/features/household-assistant/ui/HouseholdAssistant";
import { ReleaseHistoryDialog } from "@/features/release-history/ReleaseHistory";
import { claimReleaseNotice } from "@/features/release-history/update-notice";
import { APP_VERSION } from "@/shared/config/version";
import releaseHistory from "virtual:release-history";

export function App() {
  return (
    <PwaUpdateProvider>
      <AppBody />
    </PwaUpdateProvider>
  );
}

function AppBody() {
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const { phase, useCases, member, refreshData } = useApp();
  const navigation = useNavigation(member ? `${member.familyId}:${member.id}` : "anonymous");
  const { route, navigate: setRoute } = navigation;
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  /* قیف آغازین — پیش از فرم ورود. فلگ «دستگاهی» است نه per-member،
     چون در این مرحله هنوز عضوی وجود ندارد. */
  const [introSeen, setIntroSeen] = useState(() => isIntroSeen());
  /* پاسخ‌های قیف که باید فرم ثبت‌نام را از پیش پر کنند */
  const [authPrefill, setAuthPrefill] = useState<AuthPrefill | undefined>();
  /* دورزدن موقت جریان از پنل توسعه — فقط در dev معنا دارد */
  const [devOverride, setDevOverride] = useState<DevOverride>(null);
  useEffect(() => {
    if (import.meta.env.MODE !== "copy-workbench") return;
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ route?: Route; override?: DevOverride }>).detail;
      if (!detail) return;
      if (detail.route && MAIN_ROUTES.includes(detail.route)) setRoute(detail.route);
      if (detail.override === null || ["intro", "auth-login", "auth-register", "invite", "a2hs"].includes(detail.override ?? "")) {
        setDevOverride(detail.override ?? null);
      }
    };
    window.addEventListener("copy-workbench:navigate", navigate);
    window.dispatchEvent(new Event("copy-workbench:ready"));
    return () => { window.removeEventListener("copy-workbench:navigate", navigate); };
  }, [setRoute]);
  const [refreshKey, setRefreshKey] = useState(0);
  /* جستجوی ارسالی از هدر خانه → صفحه تراکنش‌ها */
  const [txSearch, setTxSearch] = useState("");
  /* سیگنال باز شدن فیلتر پیشرفته در صفحه تراکنش‌ها */
  const [filterSignal, setFilterSignal] = useState(0);
  useEffect(() => { setTxSearch(""); setFilterSignal(0); }, [member?.familyId, member?.id]);
  const { show } = useToast();
  const { updateReady, applyUpdate } = usePwaUpdateState();
  /* «خانه‌یار را به صفحه‌ی اصلی اضافه کن» — فقط گوشی، فقط مرورگر.
     همیشه صدا زده می‌شود (قاعده‌ی هوک‌ها)؛ خودش تصمیم می‌گیرد که
     visible باشد یا نه. */
  const install = useInstallPrompt();

  useTheme(member, useCases);

  /* واحد پول انتخاب‌شده در قیف آغازین را — به‌محض آماده‌شدن نشست —
     روی حساب تازه می‌نویسد و پیش‌نویس را پاک می‌کند (بی‌صدا). */
  useApplyIntroDraft();

  /* تشخیص لینک دعوت */
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (token) setInviteToken(token);
  }, []);

  /* بوم‌شدن داده پس از ورود */
  useEffect(() => {
    if (phase === "ready") {
      void refreshData().then(() => setRefreshKey((k) => k + 1)).catch((error) => show((error as Error).message));
    }
  }, [phase, refreshData]);

  /* نسخه جدید + کاربر لاگین‌شده → نوتیفیکیشن با دکمه به‌روزرسانی (یک‌بار) */
  const notifiedUpdate = useRef(false);
  useEffect(() => {
    if (updateReady && phase === "ready" && !notifiedUpdate.current) {
      notifiedUpdate.current = true;
      show("نسخه جدید خانه یار منتشر شده است", {
        label: "به‌روزرسانی",
        onClick: applyUpdate,
      });
    }
  }, [updateReady, phase, applyUpdate, show]);

  useEffect(() => {
    if (phase !== "ready" || updateReady) return;
    try {
      if (claimReleaseNotice(APP_VERSION, releaseHistory.releases.some(item => item.version === APP_VERSION), window.localStorage)) {
        show("نسخهٔ تازهٔ خانه‌یار آمادهٔ استفاده است.", {
          label: "دیدن تغییرات نسخه", onClick: () => setReleaseHistoryOpen(true),
        });
      }
    } catch { /* The optional notice never blocks startup. */ }
  }, [phase, updateReady, show]);

  const bumpRefresh = useCallback(async () => {
    await refreshData();
    setRefreshKey((k) => k + 1);
  }, [refreshData]);

  /* خواندن نیتیو پیامک بانکی روی اندروید (وب/iOS بی‌صدا رد می‌شود).
     پیامک رسیده → تراکنش «در انتظار» → رفرش فهرست.
     شرطِ روشن‌شدنش (رضایتِ دست‌کم یک حساب) داخل خودِ هوک است، نه اینجا:
     همان‌جایی که مجوز خواسته می‌شود باید معلوم باشد چرا خواسته می‌شود. */
  useNativeSmsReader(bumpRefresh);

  /* ── محتوای اصلی بر پایه‌ی فاز ──
     در حالت dev، پنل توسعه می‌تواند این جریان را موقتاً دور بزند تا
     صفحه‌هایی که عادتاً سخت در دسترس‌اند (قیف آغازین، فرم ثبت‌نام،
     پذیرش دعوت) یک‌کلیکه دیده شوند. */
  function content() {
    if ((import.meta.env.DEV || import.meta.env.MODE === "copy-workbench") && devOverride) {
      if (devOverride === "intro") {
        return (
          <OnboardingFeature
            onLogin={() => setDevOverride(null)}
            onRegister={() => setDevOverride(null)}
          />
        );
      }
      if (devOverride === "auth-login" || devOverride === "auth-register") {
        /* key لازم است: prefill فقط مقدار اولیه‌ی useState را می‌سازد، پس
           بدون remount جابه‌جایی ورود↔ثبت‌نام از پنل بی‌اثر می‌ماند */
        return useCases ? (
          <AuthFeature
            key={devOverride}
            prefill={{
              mode: devOverride === "auth-register" ? "register" : "login",
            }}
          />
        ) : null;
      }
      if (devOverride === "invite") {
        /* بدون توکن واقعی، صفحه حالت «دعوت نامعتبر» را نشان می‌دهد —
           برای وارسی ظاهر کافی است */
        return useCases ? (
          <InviteAcceptFeature token={inviteToken ?? "dev-preview"} />
        ) : null;
      }
      if (devOverride === "a2hs") {
        /* روی لپ‌تاپ، دروازه‌ی «گوشی بودن» بسته است و این صفحه هرگز
           دیده نمی‌شود؛ visible را دستی باز می‌کنیم تا ظاهرش وارسی شود.
           گام‌های نمایش‌داده‌شده همان‌هایی است که مرورگرِ فعلی می‌گیرد،
           پس برای دیدنِ گام‌های iOS باید حالت دستگاه را در devtools
           روی آیفون گذاشت. */
        return <InstallPromptFeature m={{ ...install, visible: true }} />;
      }
    }

    /* صفحه‌ی «افزودن به صفحه‌ی اصلی» — پیش از هر چیز دیگری، چون خواسته
       این بود که *اولین* چیزی باشد که کاربرِ گوشی می‌بیند؛ حتی پیش از
       بارگذاری. شرط‌های نمایش (گوشی بودن، مرورگر بودن، نصب‌نبودن) داخل
       خودِ هوک است.

       یک استثنا: لینکِ دعوت. کسی که با ?invite=… آمده برای پذیرشِ دعوت
       آمده، و مهم‌تر اینکه آیکونِ نصب‌شده start_url را بدونِ این پارامتر
       باز می‌کند — یعنی اگر اول نصب کند، توکن دعوت گم می‌شود. */
    if (install.visible && !inviteToken) {
      return <InstallPromptFeature m={install} />;
    }

    if (phase === "boot") {
      return (
        <div className="page auth-page">
          <div className="auth-wrap">
            <p className="auth-sub">در حال بارگذاری…</p>
          </div>
        </div>
      );
    }

    if (phase === "auth" && inviteToken && useCases) {
      return <InviteAcceptFeature token={inviteToken} />;
    }

    /* قیف آغازین — اولین چیزی که کاربر تازه می‌بیند، *پیش از* فرم ورود.
       دو خروجی دارد: «ورود» (کاربر قدیمی) و «ساخت حساب» (که فرم ثبت‌نام را
       از پیش پر می‌کند). صاحبان لینک دعوت بالاتر رد شده‌اند و قیف را
       نمی‌بینند، چون خانواده‌شان از قبل معلوم است. */
    if (phase === "auth" && !introSeen) {
      return (
        <OnboardingFeature
          onLogin={() => {
            markIntroSeen();
            setIntroSeen(true);
          }}
          onRegister={(draft) => {
            setAuthPrefill({ mode: "register", familyName: draft.familyName });
            setIntroSeen(true);
          }}
        />
      );
    }

    if (phase === "auth") {
      return useCases ? <AuthFeature prefill={authPrefill} /> : null;
    }

    return (
      <MainShell
        onOpenReleaseHistory={() => setReleaseHistoryOpen(true)}
        key={`${member?.familyId ?? ""}:${member?.id ?? ""}`}
        route={route}
        setRoute={setRoute}
        replaceRoute={navigation.replace}
        onBack={navigation.back}
        canBack={navigation.depth > 0 || route !== "hub"}
        bumpRefresh={bumpRefresh}
        refreshKey={refreshKey}
        currentMemberId={member?.id ?? ""}
        txSearch={txSearch}
        setTxSearch={setTxSearch}
        filterSignal={filterSignal}
        bumpFilterSignal={() => setFilterSignal((s) => s + 1)}
      />
    );
  }

  const showPageBack = phase !== "ready" || Boolean(devOverride) || (install.visible && !inviteToken);

  return (
    <>
      <div className={showPageBack ? "app-with-mobile-back" : undefined}>{content()}</div>
      {showPageBack ? <button type="button" className="mobile-page-back" aria-label="بازگشت به صفحهٔ قبل"
        onClick={() => { if (!requestBack()) { if (phase === "ready" && route !== "hub") setRoute("hub"); else if (history.length > 1) history.back(); } }}>
        <svg><use href="#i-arrow-r" /></svg>
      </button> : null}
      {/* §۸.۶ — بیرونِ content() و بی‌قیدِ phase: کسی که آفلاین است و روی
          صفحهٔ ورود گیر کرده بیشتر از همه به این خبر نیاز دارد، چون بدونش
          «رمزم غلط است» برداشت می‌کند. خودش وقتی چیزی برای گفتن نداشته
          باشد null برمی‌گردد. */}
      <OfflineBar onOpenReleaseHistory={() => setReleaseHistoryOpen(true)} />
      <ReleaseHistoryDialog open={releaseHistoryOpen} close={() => setReleaseHistoryOpen(false)} />
      {import.meta.env.DEV ? (
        <DevPanel
          route={route}
          onNav={setRoute}
          override={devOverride}
          onOverride={setDevOverride}
        />
      ) : null}
    </>
  );
}

/* آیتم‌های تب‌بار پیشین — با بازطراحی «هاب خانه» بازنشسته شد.
   عمداً به‌صورت کامنت نگه داشته شده تا اگر روزی تب‌بار برگشت،
   ترتیب و برچسب‌های قبلی در دسترس باشد:

   dashboard «خانه» · accounts «کیف پول» · reports «نمای‌کلی»
   · budgets «بودجه‌ها» · settings «بیشتر»                          */

function MainShell({
  onOpenReleaseHistory,
  route,
  setRoute,
  replaceRoute,
  onBack,
  canBack,
  bumpRefresh,
  refreshKey,
  currentMemberId,
  txSearch,
  setTxSearch,
  filterSignal,
  bumpFilterSignal,
}: {
  onOpenReleaseHistory: () => void;
  route: Route;
  setRoute: (r: Route) => void;
  replaceRoute: (r: Route) => void;
  onBack: () => void;
  canBack: boolean;
  bumpRefresh: () => Promise<void>;
  refreshKey: number;
  currentMemberId: string;
  txSearch: string;
  setTxSearch: (q: string) => void;
  filterSignal: number;
  bumpFilterSignal: () => void;
}) {
  const { useCases, members, family, shoppingLists, cur, subcategories, shoppingSync, offlineSession, refreshTasks } = useApp();
  const online = useOnline();
  const restricted = !online || shoppingSync.offline || offlineSession;
  const keyboard = useMobileViewport();
  const [visited, setVisited] = useState<Route[]>([route]);
  const allowedRoutes = restricted ? MAIN_ROUTES.filter(r => ["hub", "sections", "notifications", "shopping", "inventory", "tasks"].includes(r)) : MAIN_ROUTES;
  const accessibleVisits = visited.filter(r => allowedRoutes.includes(r));
  if (allowedRoutes.includes(route) && !accessibleVisits.includes(route)) accessibleVisits.push(route);
  if (accessibleVisits.length !== visited.length || accessibleVisits.some((r, i) => r !== visited[i])) setVisited(accessibleVisits);
  const previousUsageRoute = useRef<Route | null>(null);
  useEffect(() => {
    if (previousUsageRoute.current === route) return;
    previousUsageRoute.current = route;
    if (!restricted) void recordUsageOpen(route);
  }, [route, restricted]);
  const financeIdentity = useRef({ memberId: currentMemberId, restricted });
  const financeMounted = useRef(true);
  if (financeIdentity.current.memberId !== currentMemberId || financeIdentity.current.restricted !== restricted) {
    financeIdentity.current = { memberId: currentMemberId, restricted };
  }
  useEffect(() => {
    financeMounted.current = true;
    const invalidate = () => {
      financeIdentity.current = { ...financeIdentity.current, restricted: true };
    };
    window.addEventListener("offline", invalidate);
    return () => {
      financeMounted.current = false;
      invalidate();
      window.removeEventListener("offline", invalidate);
    };
  }, []);
  const { show } = useToast();
  const form = useTxFormModel(
    useCases!,
    members,
    currentMemberId,
    show,
    cur,
    subcategories,
  );
  const assistant = useHouseholdAssistant(useCases!, family?.id ?? "", currentMemberId, restricted);

  /* §۷ — اعلان‌ها. این‌جا زندگی می‌کند نه در HubPage، چون به `form` نیاز
     دارد (لمسِ سررسید فرمِ تراکنش را باز می‌کند) و به ناوبریِ زیرصفحهٔ
     تنظیمات. refreshKey را می‌گیرد تا پس از هر رفرشِ داده دوباره بخواند. */
  const notif = useNotificationsModel(refreshKey);
  useHouseholdRefresh(() => { if (!restricted) return pendingSms.load(); });
  const pendingSms = usePendingSmsModel(useCases!, currentMemberId, show, cur, !restricted);
  useEffect(() => { if (!restricted) void pendingSms.load(); }, [refreshKey, useCases, currentMemberId, restricted]);

  /* سیگنال‌های یک‌بارمصرف برای مقصد اعلان در صفحه‌های نگه‌داری‌شده. */
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection | null>(null);
  const [equipmentId, setEquipmentId] = useState<string | undefined>();
  const [vehicleId, setVehicleId] = useState<string | undefined>();
  const [goalId, setGoalId] = useState<string | undefined>();
  const [activityId, setActivityId] = useState<string | undefined>();
  const [calendarDate, setCalendarDate] = useState<string | undefined>();
  const quickSequence = useRef(0);
  const [quickRequest, setQuickRequest] = useState<{ id: number; kind: QuickAddKind } | null>(null);
  const consumeQuickAdd = () => setQuickRequest(null);

  const nav = useCallback(
    (r: Route) => {
      if (restricted && !["hub", "sections", "notifications", "shopping", "inventory", "tasks"].includes(r)) {
        show("این بخش به اتصال اینترنت نیاز دارد؛ خرید، انبار و کارهای خانه آفلاین در دسترس‌اند.");
        return;
      }
      setRoute(r);
      setQuickRequest(null);
      /* هر ناوبریِ معمولی مقصدِ زیرصفحهٔ تنظیمات را پاک می‌کند، وگرنه
         دفعهٔ بعد که کاربر خودش روی «تنظیمات» می‌زند، باز هم همان
         زیرصفحهٔ قبلی باز می‌شد. */
      setSettingsSection(null);
      setEquipmentId(undefined);
      setVehicleId(undefined);
      setGoalId(undefined);
      setActivityId(undefined);
      setCalendarDate(undefined);
    },
    [setRoute, restricted, show],
  );

  useEffect(() => {
    if (restricted) {
      setEquipmentId(undefined);
      setVehicleId(undefined);
      setGoalId(undefined);
      setActivityId(undefined);
      setCalendarDate(undefined);
      if (!["hub", "sections", "notifications", "shopping", "inventory", "tasks"].includes(route)) replaceRoute("hub");
      form.close();
    }
  }, [restricted, route, replaceRoute]);

  /* ورودِ مستقیم به یک زیرصفحهٔ تنظیمات (از مرکزِ اعلان) */
  const navSettingsSection = useCallback(
    (s: SettingsSection) => {
      setSettingsSection(s);
      setRoute("settings");
    },
    [setRoute],
  );

  const quickAdd = (kind: QuickAddKind) => {
    if (restricted && !["shopping", "task"].includes(kind)) {
      show("این افزودن به اتصال اینترنت نیاز دارد؛ خرید و کار خانه آفلاین در دسترس‌اند."); return;
    }
    if (form.open || form.busy || pendingSms.open || assistant.open) return;
    const destination = kind === "shopping" ? "shopping" : kind === "task" ? "tasks"
      : kind === "activity" ? "activities" : kind === "meal" ? "meals" : "transactions";
    nav(destination); setQuickRequest({ id: ++quickSequence.current, kind });
  };
  useEffect(() => {
    if (route !== "transactions" || restricted || !quickRequest || !["expense", "income", "transfer"].includes(quickRequest.kind)) return;
    if (!form.open && !form.busy) {
      form.openQuickAdd();
      form.setType(quickRequest.kind as "expense" | "income" | "transfer");
    }
    setQuickRequest(null);
  }, [route, restricted, quickRequest, form.open, form.busy]);

  const openRecord = (ref: NotificationRef) => {
    if (restricted && ref.kind !== "tasks") return;
    switch (ref.kind) {
      case "tasks": nav("tasks"); break;
      case "bills": nav("bills"); break;
      case "event": nav("calendar"); setCalendarDate(ref.dateIso); break;
      case "equipment": nav("equipment"); setEquipmentId(ref.equipmentId); break;
      case "vehicles": nav("vehicles"); setVehicleId(ref.vehicleId); break;
      case "goals":
        if (notif.goals.some((goal) => goal.id === ref.goalId && goal.ownerId === currentMemberId)) {
          nav("goals"); setGoalId(ref.goalId);
        }
        break;
      case "activities": nav("activities"); setActivityId(ref.activityId); break;
    }
  };


  /* جستجو از هدر خانه: انتقال به تراکنش‌ها با متن جستجو */
  const searchFromHome = useCallback(
    (q: string) => {
      setTxSearch(q);
      nav("transactions");
    },
    [nav, setTxSearch],
  );

  const openFilters = useCallback(() => {
    bumpFilterSignal();
    nav("transactions");
  }, [nav, bumpFilterSignal]);

  return (
    <PageNavigationContext.Provider value={{ back: onBack, canBack }}>
    <div className={`application-shell${keyboard ? " keyboard-open" : ""}`}>
      {accessibleVisits.map(pageRoute => <PageActivityContext.Provider key={pageRoute} value={pageRoute === route}>
      <div className="page-visit" data-route={pageRoute} hidden={pageRoute !== route} {...(pageRoute !== route ? { inert: "" } : {})}>
      {(() => { const route = pageRoute; return <>
        {route === "hub" || route === "sections" ? (
          <HubPage
            view={route === "sections" ? "sections" : "dashboard"}
            onNav={nav}
            onAddTransaction={type => {
              if (restricted) { show("ثبت تراکنش به اتصال اینترنت نیاز دارد."); return; }
              form.openNew(); form.setType(type);
            }}
            summary={notif}
            onOpenItem={openRecord}
            onRetry={() => { void Promise.allSettled([bumpRefresh(), notif.reload()]); }}
          />
        ) : null}
        {route === "dashboard" ? (
          <DashboardPage
            form={form}
            onNavTransactions={() => nav("transactions")}
            onNavBudgets={() => nav("budgets")}
            onOpenFilters={openFilters}
            onSearch={searchFromHome}
          />
        ) : null}
        {route === "transactions" ? (
          <TransactionsPage
            form={form}
            initialSearch={txSearch}
            onSearchConsumed={() => setTxSearch("")}
            filterSignal={filterSignal}
          />
        ) : null}
        {route === "reports" ? <ReportsPage /> : null}
        {route === "accounts" ? <AccountsPage /> : null}
        {route === "budgets" ? <BudgetsPage /> : null}
        {route === "bills" ? <BillsPage /> : null}
        {route === "calendar" ? <CalendarPage initialDate={calendarDate} summary={notif}
          onInitialDateConsumed={() => setCalendarDate(undefined)}
          onOpenItem={openRecord} onRefresh={bumpRefresh} /> : null}
        {route === "shopping" ? <ShoppingPage quickAddId={quickRequest?.kind === "shopping" ? quickRequest.id : undefined} onQuickAddConsumed={consumeQuickAdd} /> : null}
        {route === "inventory" ? <InventoryPage /> : null}
        {route === "tasks" ? <TasksPage quickAddId={quickRequest?.kind === "task" ? quickRequest.id : undefined} onQuickAddConsumed={consumeQuickAdd} /> : null}
        {route === "documents" ? <DocumentsPage onChanged={notif.reload} /> : null}
        {route === "meals" ? <MealsPage quickAddId={quickRequest?.kind === "meal" ? quickRequest.id : undefined} onQuickAddConsumed={consumeQuickAdd} /> : null}
        {route === "equipment" ? <EquipmentPage initialEquipmentId={equipmentId}
          onInitialEquipmentConsumed={() => setEquipmentId(undefined)}
          onOpenDocuments={() => nav("documents")}
          onOpenTasks={() => nav("tasks")} onChanged={notif.reload} /> : null}
        {route === "vehicles" ? <VehiclesPage initialVehicleId={vehicleId}
          onInitialVehicleConsumed={() => setVehicleId(undefined)}
          onOpenTasks={() => nav("tasks")} onOpenDocuments={() => nav("documents")}
          onOpenFinance={async (id) => {
            const captured = financeIdentity.current;
            const current = () => financeMounted.current && financeIdentity.current === captured && navigator.onLine !== false;
            if (captured.restricted || !current() || !useCases) return;
            try {
              const rows = await useCases.listTransactions.execute();
              if (!current()) return;
              const tx = rows.find((row) => row.id === id);
              if (!tx) { show("تراکنش مالی دیگر در دسترس نیست."); return; }
              nav("transactions"); form.openEdit(tx);
            } catch (error) {
              if (current()) show(error instanceof Error ? error.message : "دریافت تراکنش ناموفق بود.");
            }
          }}
          onChanged={async () => { await bumpRefresh(); await notif.reload(); }} /> : null}
        {route === "market" ? <MarketPage /> : null}
        {route === "goals" ? <GoalsPage initialGoalId={goalId}
          onInitialGoalConsumed={() => setGoalId(undefined)} onChanged={notif.reload} /> : null}
        {route === "activities" ? <ActivitiesPage initialActivityId={activityId}
          quickAddId={quickRequest?.kind === "activity" ? quickRequest.id : undefined} onQuickAddConsumed={consumeQuickAdd}
          onInitialActivityConsumed={() => setActivityId(undefined)}
          onChanged={async () => { await bumpRefresh(); await notif.reload(); }} /> : null}
        {route === "children" ? <ChildrenPage navigate={nav}
          onChanged={async () => { await bumpRefresh(); await notif.reload(); }} /> : null}
        {route === "pets" ? <PetsPage onOpenTasks={() => nav("tasks")}
          onChanged={async () => { await refreshTasks(); await notif.reload(); }} /> : null}
        {route === "settings" ? (
          <SettingsPage
            onOpenReleaseHistory={onOpenReleaseHistory}
            initialSection={settingsSection}
            onInitialSectionConsumed={() => setSettingsSection(null)}
            onNotificationPrefsChanged={() => void Promise.all([notif.reload(), refreshTasks()])}
          />
        ) : null}
      {route === "notifications" ? <NotificationCenterFeature
        m={notif}
        sms={{ count: pendingSms.list.length, loading: pendingSms.loading, error: pendingSms.loadError }}
        onOpenSms={() => nav("sms")}
        form={form}
        joinRequests={notif.joinRequests}
        onOpenJoinRequests={() => navSettingsSection("joinRequests")}
        onOpenBills={() => nav("bills")}
        onOpenInventory={() => nav("inventory")}
        onOpenTasks={() => nav("tasks")}
        onOpenCalendar={(date) => {
          if (restricted) return;
          nav("calendar"); setCalendarDate(date);
        }}
        onOpenDocuments={() => nav("documents")}
        onOpenEquipment={(id) => {
          if (restricted) return;
          nav("equipment"); setEquipmentId(id);
        }}
        onOpenVehicles={(id) => {
          if (restricted) return;
          nav("vehicles"); setVehicleId(id);
        }}
        onOpenGoal={(id) => {
          if (restricted) return;
          nav("goals"); setGoalId(id);
        }}
        onOpenActivity={(id) => {
          if (restricted) return;
          nav("activities"); setActivityId(id);
        }}
      /> : null}
      {route === "sms" ? <SmsPage model={pendingSms} onImported={async () => {
        await bumpRefresh(); await pendingSms.load({ review: true });
      }} /> : null}
       </>; })()}
       </div>
       </PageActivityContext.Provider>)}
      <FloatingNavigation home={route === "hub"} sections={route === "sections"} onHome={() => nav("hub")}
        onQuickAdd={quickAdd}
        onSections={() => nav("sections")} notifications={route === "notifications"} count={notif.count + pendingSms.list.length}
        onNotifications={() => nav("notifications")} hidden={form.open || pendingSms.open || assistant.open}
        onAssistant={() => { if (!form.open && !form.busy && !pendingSms.open) assistant.show(route); }} />
      <HouseholdAssistant model={assistant} offline={restricted} lists={shoppingLists} members={members}
        onChanged={async () => { await bumpRefresh(); await notif.reload(); }}
        onShopping={() => { assistant.close(); nav("shopping"); }} />
      {!restricted ? <TransactionFormFeature form={form} onImported={async () => {
        await bumpRefresh(); form.close(); nav("sms"); await pendingSms.load({ review: true });
      }} /> : null}
      {!restricted ? <PendingSmsFeature model={pendingSms} /> : null}

    </div>
    </PageNavigationContext.Provider>
  );
}
import { useHouseholdRefresh } from "@/shared/lib/useHouseholdRefresh";
