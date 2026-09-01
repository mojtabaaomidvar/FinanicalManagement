/* صفحه تنظیمات — دو شاخه اصلی: مالی | برنامه + پروفایل/خانواده/رویدادها */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card } from "@/shared/ui";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { ProfileCard } from "./ProfileCard";
import { EventsCard } from "./EventsCard";
import { MembersCard } from "./MembersCard";
import { SettingsSubPage } from "./SettingsSubPage";
import { formatAmount, liveFormatAmount } from "@/shared/lib/format";

type SettingsSection =
  | "family"
  | "profile"
  | "events"
  | "finance"
  | "app";

const APP_VERSION = "۵.۴.۰";

export function SettingsPage() {
  const { useCases, family, members, txs, onLoggedOut } = useApp();
  const { show } = useToast();

  const [section, setSection] = useState<SettingsSection | null>(null);

  const [budget, setBudget] = useState("");
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    setBudget(family?.budget ? formatAmount(family.budget) : "");
  }, [family?.budget]);

  async function saveSettings(patch: {
    budget?: number;
    currency?: string;
    dark?: boolean;
  }) {
    if (!family) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await useCases!.updateFamilySettings.execute({
          budget: patch.budget ?? family.budget,
          currency: patch.currency ?? family.currency,
          dark: patch.dark ?? family.dark,
        });
      } catch {
        /* بی‌صدا */
      }
    }, 700);
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
        <Card title="بودجه ماهانه">
          <div className="setting-row">
            <div>
              <h4>سقف هزینه‌های ماه</h4>
              <p>۰ = بدون بودجه</p>
            </div>
            <input
              type="text"
              className="num-input"
              inputMode="numeric"
              placeholder="۱۰,۰۰۰,۰۰۰"
              value={budget}
              onChange={(e) => {
                const fa = liveFormatAmount(e.target.value);
                setBudget(fa);
                const en = fa.replace(/[۰-۹]/g, (d) =>
                  String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
                ).replace(/,/g, "");
                saveSettings({ budget: +en || 0 });
              }}
            />
          </div>
          <CheckBudgetStatus status={budgetStatus} />
        </Card>

        <Card title="واحد پول">
          <div className="setting-row">
            <div>
              <h4>واحد نمایش مبالغ</h4>
              <p>در همه صفحات اعمال می‌شود</p>
            </div>
            <select
              className="select-input"
              value={family?.currency ?? "تومان"}
              onChange={(e) => saveSettings({ currency: e.target.value })}
            >
              <option value="تومان">تومان</option>
              <option value="ریال">ریال</option>
              <option value="دلار">دلار</option>
            </select>
          </div>
        </Card>

        <Card title="خروجی داده‌ها">
          <div className="setting-row">
            <div>
              <h4>فایل پشتیبان</h4>
              <p>دانلود همه تراکنش‌ها (JSON)</p>
            </div>
            <button
              className="action-btn"
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
              دانلود
            </button>
          </div>
        </Card>
      </SettingsSubPage>
    );
  }

  /* ── تنظیمات برنامه ── */
  if (section === "app") {
    return (
      <SettingsSubPage title="تنظیمات برنامه" onBack={back}>
        <Card title="ظاهر">
          <div className="setting-row">
            <div>
              <h4>حالت تیره</h4>
              <p>سرمه‌ای تیره به‌جای روشن</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={family?.dark ?? false}
                onChange={(e) => {
                  const dark = e.target.checked;
                  document.documentElement.dataset.theme = dark ? "dark" : "light";
                  saveSettings({ dark });
                }}
              />
              <span className="slider" />
            </label>
          </div>
        </Card>

        <Card title="به‌روزرسانی">
          <div className="setting-row">
            <div>
              <h4>بررسی نسخه جدید</h4>
              <p>بارگذاری مجدد اپلیکیشن از سرور</p>
            </div>
            <button
              className="action-btn"
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
              به‌روزرسانی
            </button>
          </div>
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
              نسخه {APP_VERSION} · همراه مطمئن خانواده در مسیر آرامش مالی
            </p>
          </div>
          <div className="setting-row">
            <div>
              <h4>خروج از حساب</h4>
              <p>بازگشت به صفحه ورود</p>
            </div>
            <button className="action-btn danger" onClick={logout}>
              خروج
            </button>
          </div>
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
