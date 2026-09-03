/* ریشه اپ — ناوبری، لینک دعوت، تب‌بار، پیامک‌های pending */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./providers/AppProvider";
import { useTheme } from "./providers/useTheme";
import type { Route } from "./router";
import { PwaUpdateProvider, usePwaUpdateState } from "./pwaUpdate.tsx";
import { AuthFeature, InviteAcceptFeature } from "@/features/auth";
import { TransactionFormFeature, useTxFormModel } from "@/features/transaction-form";
import { PendingSmsFeature } from "@/features/pending-sms";
import { DashboardPage } from "@/pages/DashboardPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { BudgetsPage } from "@/pages/BudgetsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useToast } from "./providers/ToastProvider";

export function App() {
  return (
    <PwaUpdateProvider>
      <AppBody />
    </PwaUpdateProvider>
  );
}

function AppBody() {
  const { phase, useCases, member, refreshData } = useApp();
  const [route, setRoute] = useState<Route>("dashboard");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const { show } = useToast();
  const { updateReady, applyUpdate } = usePwaUpdateState();

  useTheme(member, useCases);

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

  if (phase === "auth") {
    return useCases ? <AuthFeature /> : null;
  }

  return (
    <MainShell
      route={route}
      setRoute={setRoute}
      bumpRefresh={bumpRefresh}
      refreshKey={refreshKey}
      currentMemberId={member?.id ?? ""}
    />
  );
}

/* آیتم‌های تب‌بار (RTL) — خانه اول؛ FAB پلاس جدا از نوار است
   تراکنش‌ها از هدر خانه (جستجو) و دکمه «همه» دسترس‌پذیر است */
const NAV_ITEMS: { r: Route; icon: string; label: string }[] = [
  { r: "dashboard", icon: "i-home", label: "خانه" },
  { r: "accounts", icon: "i-card", label: "حساب‌ها" },
  { r: "reports", icon: "i-chart", label: "نمای‌کلی" },
  { r: "budgets", icon: "i-wallet", label: "بودجه‌ها" },
  { r: "settings", icon: "i-gear", label: "بیشتر" },
];

function MainShell({
  route,
  setRoute,
  bumpRefresh,
  refreshKey,
  currentMemberId,
}: {
  route: Route;
  setRoute: (r: Route) => void;
  bumpRefresh: () => Promise<void>;
  refreshKey: number;
  currentMemberId: string;
}) {
  const { useCases, members, family } = useApp();
  const { show } = useToast();
  const form = useTxFormModel(
    useCases!,
    members,
    currentMemberId,
    show,
    family?.currency ?? "تومان",
  );

  const activeIdx = Math.max(
    0,
    NAV_ITEMS.findIndex((t) => t.r === route),
  );

  const nav = useCallback(
    (r: Route) => {
      setRoute(r);
      window.scrollTo({ top: 0 });
    },
    [setRoute],
  );

  return (
    <>
      <div key={route} className="page-anim">
        {route === "dashboard" ? (
          <DashboardPage
            form={form}
            onImported={bumpRefresh}
            onNavTransactions={() => nav("transactions")}
          />
        ) : null}
        {route === "transactions" ? <TransactionsPage form={form} /> : null}
        {route === "reports" ? <ReportsPage form={form} /> : null}
        {route === "accounts" ? <AccountsPage /> : null}
        {route === "budgets" ? <BudgetsPage /> : null}
        {route === "settings" ? <SettingsPage /> : null}
      </div>

      <TransactionFormFeature form={form} />
      <PendingSmsFeature refreshKey={refreshKey} />

      {/* داک پایین — دو المان مجزا: نوار شیشه‌ای تب‌ها + FAB پلاس */}
      <div className="tabbar-dock">
        <nav className="tabbar tabbar-5" aria-label="ناوبری اصلی">
          {/* پیل لغزنده — کپسول محو پشت تب فعال */}
          <span
            className="tab-pill"
            aria-hidden="true"
            style={{
              insetInlineStart: `calc(${activeIdx} * 20% + 5px)`,
              width: "calc(20% - 10px)",
            }}
          />

          {/* ترتیب RTL: خانه، حساب‌ها، نمای‌کلی، بودجه‌ها، بیشتر */}
          {NAV_ITEMS.map((t) => (
            <button
              key={t.r}
              className={`tab-btn ${route === t.r ? "active" : ""}`}
              aria-current={route === t.r ? "page" : undefined}
              onClick={() => nav(t.r)}
            >
              <span className="tab-ico">
                <svg>
                  <use href={`#${t.icon}`} />
                </svg>
              </span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>

        {/* FAB پلاس — افزودن تراکنش، جدا از نوار با گپ مشخص */}
        <button
          type="button"
          className="fab-add"
          aria-label="افزودن تراکنش"
          onClick={() => form.openNew()}
        >
          <svg>
            <use href="#i-plus" />
          </svg>
        </button>
      </div>
    </>
  );
}
