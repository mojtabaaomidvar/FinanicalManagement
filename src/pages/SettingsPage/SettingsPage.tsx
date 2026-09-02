/* صفحه تنظیمات — دو شاخه اصلی: مالی | برنامه + پروفایل/خانواده/رویدادها */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Segmented } from "@/shared/ui";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { ProfileCard } from "./ProfileCard";
import { EventsCard } from "./EventsCard";
import { MembersCard } from "./MembersCard";
import { SettingsSubPage } from "./SettingsSubPage";
import { useTheme } from "@/app/providers/useTheme";
import { formatAmount, liveFormatAmount } from "@/shared/lib/format";

type SettingsSection =
  | "family"
  | "profile"
  | "events"
  | "finance"
  | "app";

const APP_VERSION = "۵.۵.۰";

export function SettingsPage() {
  const { useCases, family, members, txs, member, refreshData, onLoggedOut } =
    useApp();
  const { show } = useToast();
  const { themeMode, changeTheme } = useTheme(member, useCases);

  const [section, setSection] = useState<SettingsSection | null>(null);

  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("تومان");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setBudget(family?.budget ? formatAmount(family.budget) : "");
    setCurrency(family?.currency ?? "تومان");
    setDirty(false);
  }, [family?.budget, family?.currency]);

  /** اعمال تغییرات مالی — ذخیره در سرور + ری‌فرش فوری کل داده */
  async function applyFinanceSettings() {
    if (!family) return;
    setSaving(true);
    try {
      const budgetNum = budget
        .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
        .replace(/,/g, "");
      await useCases!.updateFamilySettings.execute({
        budget: +budgetNum || 0,
        currency,
        dark: family.dark,
      });
      await refreshData();
      setDirty(false);
      show("تغییرات اعمال شد");
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await useCases!.logout.execute();
    onLoggedOut();
    location.reload();
  }

  const budgetStatus = useMemo(
    () => (useCases && family ? useCases.checkBudgetStatus.execute(family.budget, txs) : null),
    [useCases, family, txs],
  );

  const back = () => setSection(null);

  /* ── زیرصفحه‌ها ── */
  if (section === "profile") {
    return (
      <SettingsSubPage title="پروفایل من" onBack={back}>
        <ProfileCard />
      </SettingsSubPage>
    );
  }

  if (section === "family") {
    return (
      <SettingsSubPage title="خانواده" onBack={back}>
        <MembersCard />
      </SettingsSubPage>
    );
  }

  if (section === "events") {
    return (
      <SettingsSubPage title="رویدادهای مهم" onBack={back}>
        <EventsCard />
      </SettingsSubPage>
    );
  }

  /* ── تنظیمات مالی ── */
  if (section === "finance") {
    return (
      <SettingsSubPage title="تنظیمات مالی" onBack={back}>
        <Card>
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">بودجه ماهانه ({currency})</label>
              <input
                type="text"
                className="num-input"
                inputMode="numeric"
                placeholder="۰"
                value={budget}
                onChange={(e) => {
                  setBudget(liveFormatAmount(e.target.value));
                  setDirty(true);
                }}
              />
            </div>
            <div className="form-row">
              <label className="form-label">واحد پول</label>
              <select
                className="select-input"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="تومان">تومان</option>
                <option value="ریال">ریال</option>
              </select>
            </div>
          </div>
          <CheckBudgetStatus status={budgetStatus} currency={currency} />
          <button
            className="btn-primary btn-block"
            style={{ marginTop: 12 }}
            disabled={!dirty || saving}
            onClick={applyFinanceSettings}
          >
            {saving ? "…" : dirty ? "اعمال تغییرات" : "ذخیره شد"}
          </button>
        </Card>

        <Card title="خروجی داده‌ها">
          <button
            className="btn-secondary btn-block"
            onClick={() => {
              if (!family) return;
              const data = useCases!.buildBackupJson.execute({
                family,
                members,
                transactions: txs,
              });
              const blob = new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download =
                "khaneyar-backup-" +
                new Date().toISOString().slice(0, 10) +
                ".json";
              a.click();
              URL.revokeObjectURL(a.href);
              show("فایل پشتیبان دانلود شد");
            }}
          >
            دانلود فایل پشتیبان
          </button>
        </Card>
      </SettingsSubPage>
    );
  }

  /* ── تنظیمات برنامه ── */
  if (section === "app") {
    return (
      <SettingsSubPage title="تنظیمات برنامه" onBack={back}>
        <Card title="تم">
          <Segmented
            value={themeMode}
            onChange={(v) => void changeTheme(v)}
            options={[
              { value: "light", label: "روشن" },
              { value: "dark", label: "تیره" },
              { value: "auto", label: "خودکار" },
            ]}
          />
        </Card>

        <Card title="به‌روزرسانی">
          <button
            className="btn-secondary btn-block"
            onClick={async () => {
              show("در حال بررسی…");
              try {
                const keys = await caches.keys();
                await Promise.all(keys.map((k) => caches.delete(k)));
              } catch {
                /* بی‌صدا */
              }
              location.reload();
            }}
          >
            دریافت آخرین نسخه
          </button>
        </Card>

        <Card title="درباره">
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div className="auth-art" style={{ margin: "0 auto 12px" }}>
              <img src="/khaneyar-mark.svg" alt="خانه یار" />
            </div>
            <h4 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
              خانه یار
            </h4>
            <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
              دستیار مالی خانواده
            </p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 10 }}>
              نسخه {APP_VERSION}
            </p>
          </div>
          <button className="btn-danger-block" onClick={logout}>
            خروج از حساب
          </button>
        </Card>
      </SettingsSubPage>
    );
  }

  /* ── فهرست اصلی ── */
  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>تنظیمات</h1>
          <p>شخصی‌سازی اپلیکیشن</p>
        </div>
      </header>

      <div className="content">
        <Card>
          <button className="settings-nav-row" onClick={() => setSection("finance")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-wallet" />
              </svg>
            </span>
            <div>
              <h4>تنظیمات مالی</h4>
              <p>بودجه ماهانه، واحد پول و خروجی داده</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>

          <button className="settings-nav-row" onClick={() => setSection("app")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-gear" />
              </svg>
            </span>
            <div>
              <h4>تنظیمات برنامه</h4>
              <p>تم، به‌روزرسانی و درباره اپلیکیشن</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>

          <button className="settings-nav-row" onClick={() => setSection("profile")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-users" />
              </svg>
            </span>
            <div>
              <h4>پروفایل من</h4>
              <p>آواتار، نام، تاریخ تولد و کد ملی</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>

          <button className="settings-nav-row" onClick={() => setSection("family")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-home" />
              </svg>
            </span>
            <div>
              <h4>خانواده</h4>
              <p>اعضا و دعوت با لینک/QR</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>

          <button className="settings-nav-row" onClick={() => setSection("events")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-bell" />
              </svg>
            </span>
            <div>
              <h4>رویدادهای مهم</h4>
              <p>تولدها، سالگردها و مناسبت‌ها</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>
        </Card>

        <p className="version-tag">خانه یار · نسخه {APP_VERSION}</p>
      </div>
    </section>
  );
}
