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
import { SettingsPage } from "@/pages/SettingsPage";
import { useToast } from "./providers/ToastProvider";

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

  return (
    <>
      {route === "dashboard" ? (
        <DashboardPage
          form={form}
          onImported={bumpRefresh}
          onNavTransactions={() => nav("transactions")}
        />
      ) : null}
      {route === "transactions" ? <TransactionsPage form={form} /> : null}
      {route === "reports" ? <ReportsPage /> : null}
      {route === "settings" ? <SettingsPage /> : null}

      <button
        className="fab"
        aria-label="افزودن تراکنش"
        onClick={form.openNew}
      >
        <svg>
          <use href="#i-plus" />
        </svg>
      </button>

      <TransactionFormFeature form={form} />
      <PendingSmsFeature refreshKey={refreshKey} />

      <nav className="tabbar" aria-label="ناوبری اصلی">
        {[
          { r: "dashboard" as Route, icon: "i-home", label: "داشبورد" },
          { r: "transactions" as Route, icon: "i-receipt", label: "تراکنش‌ها" },
          { r: "reports" as Route, icon: "i-chart", label: "گزارش‌ها" },
          { r: "settings" as Route, icon: "i-gear", label: "تنظیمات" },
        ].map((t) => (
          <button
            key={t.r}
            className={`tab-btn ${route === t.r ? "active" : ""}`}
            onClick={() => nav(t.r)}
          >
            <svg>
              <use href={`#${t.icon}`} />
            </svg>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
