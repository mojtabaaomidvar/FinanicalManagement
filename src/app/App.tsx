/* ریشه اپ — ناوبری، لینک دعوت، تب‌بار، پیامک‌های pending */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./providers/AppProvider";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { useNativeSmsReader } from "./useNativeSmsReader";
import { useTheme } from "./providers/useTheme";
import type { Route } from "./router";
import { PwaUpdateProvider, usePwaUpdateState } from "./pwaUpdate.tsx";
import { AuthFeature, InviteAcceptFeature, type AuthPrefill } from "@/features/auth";
import {
  OnboardingFeature,
  isIntroSeen,
  markIntroSeen,
  useApplyIntroDraft,
} from "@/features/onboarding";
import { TransactionFormFeature, useTxFormModel } from "@/features/transaction-form";
import { PendingSmsFeature } from "@/features/pending-sms";
import { DashboardPage } from "@/pages/DashboardPage";
import { HubPage } from "@/pages/HubPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { BudgetsPage } from "@/pages/BudgetsPage";
import { MarketPage } from "@/pages/MarketPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useToast } from "./providers/ToastProvider";
import { DevPanel, type DevOverride } from "./dev/DevPanel";

export function App() {
  return (
    <PwaUpdateProvider>
      <AppBody />
    </PwaUpdateProvider>
  );
}

function AppBody() {
  const { phase, useCases, member, refreshData } = useApp();
  const [route, setRoute] = useState<Route>("hub");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  /* قیفِ آغازین — پیش از فرمِ ورود. فلگ «دستگاهی» است نه per-member،
     چون در این مرحله هنوز عضوی وجود ندارد. */
  const [introSeen, setIntroSeen] = useState(() => isIntroSeen());
  /* پاسخ‌های قیف که باید فرمِ ثبت‌نام را از پیش پر کنند */
  const [authPrefill, setAuthPrefill] = useState<AuthPrefill | undefined>();
  /* دورزدنِ موقتِ جریان از پنلِ توسعه — فقط در dev معنا دارد */
  const [devOverride, setDevOverride] = useState<DevOverride>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /* جستجوی ارسالی از هدر خانه → صفحه تراکنش‌ها */
  const [txSearch, setTxSearch] = useState("");
  /* سیگنال باز شدن فیلتر پیشرفته در صفحه تراکنش‌ها */
  const [filterSignal, setFilterSignal] = useState(0);
  const { show } = useToast();
  const { updateReady, applyUpdate } = usePwaUpdateState();

  useTheme(member, useCases);

  /* واحدِ پولِ انتخاب‌شده در قیفِ آغازین را — به‌محضِ آماده‌شدنِ نشست —
     روی حسابِ تازه می‌نویسد و پیش‌نویس را پاک می‌کند (بی‌صدا). */
  useApplyIntroDraft();

  /* تشخیص لینک دعوت */
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("invite");
    if (token) setInviteToken(token);
  }, []);

  /* بوم‌شدن داده پس از ورود */
  useEffect(() => {
    if (phase === "ready") {
      void refreshData().then(() => setRefreshKey((k) => k + 1));
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

  const bumpRefresh = useCallback(async () => {
    await refreshData();
    setRefreshKey((k) => k + 1);
  }, [refreshData]);

  /* خواندنِ نیتیوِ پیامکِ بانکی روی اندروید (وب/iOS بی‌صدا رد می‌شود).
     پیامکِ رسیده → تراکنشِ «در انتظار» → رفرشِ فهرست */
  useNativeSmsReader(phase === "ready", useCases, bumpRefresh);

  /* ── محتوای اصلی بر پایه‌ی فاز ──
     در حالتِ dev، پنلِ توسعه می‌تواند این جریان را موقتاً دور بزند تا
     صفحه‌هایی که عادتاً سخت در دسترس‌اند (قیفِ آغازین، فرمِ ثبت‌نام،
     پذیرشِ دعوت) یک‌کلیکه دیده شوند. */
  function content() {
    if (import.meta.env.DEV && devOverride) {
      if (devOverride === "intro") {
        return (
          <OnboardingFeature
            onLogin={() => setDevOverride(null)}
            onRegister={() => setDevOverride(null)}
          />
        );
      }
      if (devOverride === "auth-login" || devOverride === "auth-register") {
        /* key لازم است: prefill فقط مقدارِ اولیه‌ی useState را می‌سازد، پس
           بدونِ remount جابه‌جاییِ ورود↔ثبت‌نام از پنل بی‌اثر می‌ماند */
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
        /* بدونِ توکنِ واقعی، صفحه حالتِ «دعوت نامعتبر» را نشان می‌دهد —
           برای وارسیِ ظاهر کافی است */
        return useCases ? (
          <InviteAcceptFeature token={inviteToken ?? "dev-preview"} />
        ) : null;
      }
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

    /* قیفِ آغازین — اولین چیزی که کاربرِ تازه می‌بیند، *پیش از* فرمِ ورود.
       دو خروجی دارد: «ورود» (کاربرِ قدیمی) و «ساختِ حساب» (که فرمِ ثبت‌نام را
       از پیش پر می‌کند). صاحبانِ لینکِ دعوت بالاتر رد شده‌اند و قیف را
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
        route={route}
        setRoute={setRoute}
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

  return (
    <>
      {content()}
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

/* آیتم‌های تب‌بارِ پیشین — با بازطراحیِ «هابِ خانه» بازنشسته شد.
   عمداً به‌صورت کامنت نگه داشته شده تا اگر روزی تب‌بار برگشت،
   ترتیب و برچسب‌های قبلی در دسترس باشد:

   dashboard «خانه» · accounts «کیف پول» · reports «نمای‌کلی»
   · budgets «بودجه‌ها» · settings «بیشتر»                          */

function MainShell({
  route,
  setRoute,
  bumpRefresh,
  refreshKey,
  currentMemberId,
  txSearch,
  setTxSearch,
  filterSignal,
  bumpFilterSignal,
}: {
  route: Route;
  setRoute: (r: Route) => void;
  bumpRefresh: () => Promise<void>;
  refreshKey: number;
  currentMemberId: string;
  txSearch: string;
  setTxSearch: (q: string) => void;
  filterSignal: number;
  bumpFilterSignal: () => void;
}) {
  const { useCases, members, cur, subcategories } = useApp();
  const { show } = useToast();
  const form = useTxFormModel(
    useCases!,
    members,
    currentMemberId,
    show,
    cur,
    subcategories,
  );

  const nav = useCallback(
    (r: Route) => {
      setRoute(r);
      window.scrollTo({ top: 0 });
    },
    [setRoute],
  );

  /* بازگشتِ دکمه/سوایپ در هر صفحه‌ای جز هاب = برگشت به هاب (نه خروج از اپ) */
  useBackGuard(route !== "hub", () => nav("hub"));

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
    <>
      <div key={route} className="page-anim">
        {route === "hub" ? (
          <HubPage onNav={nav} onAddTransaction={() => form.openNew()} />
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
        {route === "market" ? <MarketPage /> : null}
        {route === "settings" ? <SettingsPage /> : null}
      </div>

      <TransactionFormFeature form={form} onImported={bumpRefresh} />
      <PendingSmsFeature refreshKey={refreshKey} />

      {/* داکِ پایین (تب‌بارِ ۵تایی + FAB پلاس) از بازطراحیِ «هابِ خانه»
          بازنشسته شد: ناوبری حالا از راهِ کاشی‌های هاب و بازگشتِ
          سخت‌افزاری/سوایپ انجام می‌شود و ثبتِ تراکنش از دکمه‌ی پهنِ
          «ثبت خرج یا درآمد» در هاب باز می‌شود. NAV_ITEMS و کلاس‌های
          CSS تب‌بار و دکمه‌ی شناور عمداً نگه داشته شده‌اند تا اگر
          خواستیم دوباره برگردند. */}
    </>
  );
}
