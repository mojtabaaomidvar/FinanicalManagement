/* ریشه اپ — ناوبری، لینک دعوت، تب‌بار، پیامک‌های pending */

import { useCallback, useEffect, useState } from "react";
import { useApp } from "./providers/AppProvider";
import { useTheme } from "./providers/useTheme";
import type { Route } from "./router";
import { AuthFeature, InviteAcceptFeature } from "@/features/auth";
import { TransactionFormFeature, useTxFormModel } from "@/features/transaction-form";
import { PendingSmsFeature } from "@/features/pending-sms";
import { DashboardPage } from "@/pages/DashboardPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { useToast } from "./providers/ToastProvider";

/* ترتیب تب‌ها در DOM (RTL) — مبنای موقعیت نشانگر متحرک تب‌بار */
const TAB_ORDER: Route[] = [
  "transactions",
  "reports",
  "dashboard",
  "accounts",
  "settings",
];

export function App() {
  const { phase, useCases, member, family, refreshData } = useApp();
  const [route, setRoute] = useState<Route>("dashboard");
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useTheme(phase === "ready" ? family : null);

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
  const { useCases, members } = useApp();
  const { show } = useToast();
  const form = useTxFormModel(useCases!, members, currentMemberId, show);

  const nav = useCallback(
    (r: Route) => {
      setRoute(r);
      window.scrollTo({ top: 0 });
    },
    [setRoute],
  );

  /* ترتیب تب‌ها در DOM (RTL) برای موقعیت نشانگر متحرک */
  const tabIndex = TAB_ORDER.indexOf(route);
  void tabIndex;

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
        {route === "settings" ? <SettingsPage /> : null}
      </div>

      <TransactionFormFeature form={form} />
      <PendingSmsFeature refreshKey={refreshKey} />

      <nav className="tabbar tabbar-5" aria-label="ناوبری اصلی">
        {/* نشانگر متحرک — موقعیت بر اساس تب فعال (RTL) */}
        <div
          className="tab-ind"
          style={{
            insetInlineStart: `calc(${TAB_ORDER.indexOf(route) * 20}% + 4px)`,
          }}
        />

        {/* راست (در RTL اول) */}
        <button
          className={`tab-btn ${route === "transactions" ? "active" : ""}`}
          onClick={() => nav("transactions")}
        >
          <svg>
            <use href="#i-receipt" />
          </svg>
          <span>تراکنش‌ها</span>
        </button>
        <button
          className={`tab-btn ${route === "reports" ? "active" : ""}`}
          onClick={() => nav("reports")}
        >
          <svg>
            <use href="#i-chart" />
          </svg>
          <span>گزارش‌ها</span>
        </button>

        {/* دکمه خانه مرکزی */}
        <button
          className={`tab-home ${route === "dashboard" ? "active" : ""}`}
          onClick={() => nav("dashboard")}
          aria-label="داشبورد"
        >
          <svg>
            <use href="#i-home" />
          </svg>
        </button>

        {/* چپ */}
        <button
          className={`tab-btn ${route === "accounts" ? "active" : ""}`}
          onClick={() => nav("accounts")}
        >
          <svg>
            <use href="#i-card" />
          </svg>
          <span>کارت‌ها</span>
        </button>
        <button
          className={`tab-btn ${route === "settings" ? "active" : ""}`}
          onClick={() => nav("settings")}
        >
          <svg>
            <use href="#i-gear" />
          </svg>
          <span>تنظیمات</span>
        </button>
      </nav>
    </>
  );
}
