/* صفحه تنظیمات — دو شاخه اصلی: مالی | برنامه + پروفایل/خانواده/رویدادها */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Segmented } from "@/shared/ui";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { ProfileCard } from "./ProfileCard";
import { EventsCard } from "./EventsCard";
import { MembersCard } from "./MembersCard";
import { AccountsCard } from "./AccountsCard";
import { SettingsSubPage } from "./SettingsSubPage";
import { useTheme } from "@/app/providers/useTheme";
import { usePwaUpdateState } from "@/app/pwaUpdate.tsx";
import { APP_VERSION } from "@/shared/config/version";
import { toFa } from "@/shared/lib/digits";
import {
  formatAmount,
  liveFormatAmount,
  parseAmountInput,
} from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import {
  transactionsToCsv,
  transactionsToExcelXml,
  downloadTextFile,
} from "@/shared/lib/csv";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { CATEGORIES } from "@/domain/category/category.catalog";

type SettingsSection =
  | "family"
  | "profile"
  | "events"
  | "finance"
  | "app";

export function SettingsPage() {
  const {
    useCases,
    family,
    members,
    txs,
    accounts,
    member,
    customCategories,
    refreshData,
    onLoggedOut,
  } = useApp();
  const { show } = useToast();
  const { themeMode, changeTheme } = useTheme(member, useCases);

  const [section, setSection] = useState<SettingsSection | null>(null);

  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("تومان");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setBudget(
      family?.budget
        ? formatAmount(toDisplay(family.budget, family?.currency ?? "تومان"))
        : "",
    );
    setCurrency(family?.currency ?? "تومان");
    setDirty(false);
  }, [family?.budget, family?.currency]);

  /** اعمال تغییرات مالی — ذخیره در سرور + ری‌فرش فوری کل داده */
  async function applyFinanceSettings() {
    if (!family) return;
    setSaving(true);
    try {
      await useCases!.updateFamilySettings.execute({
        budget: fromDisplay(parseAmountInput(budget), currency),
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
        <PremiumCard />
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
    const isOwner = member?.role === "owner";
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
                disabled={!isOwner}
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
                  const next = e.target.value;
                  /* بودجه نمایشی به واحد جدید تبدیل می‌شود (پایه: تومان) */
                  const cur = parseAmountInput(budget);
                  if (cur) {
                    setBudget(
                      formatAmount(toDisplay(fromDisplay(cur, currency), next)),
                    );
                  }
                  setCurrency(next);
                  setDirty(true);
                }}
              >
                <option value="تومان">تومان</option>
                <option value="ریال">ریال</option>
              </select>
            </div>
          </div>
          {!isOwner ? (
            <p
              style={{
                fontSize: 11.5,
                color: "var(--text-3)",
                marginTop: 4,
              }}
            >
              تغییر بودجه ماهانه فقط توسط مدیر خانواده امکان‌پذیر است
            </p>
          ) : null}
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

        <AccountsCard />

        {/* تراکنش‌های زمان‌بندی‌شده (تکرارشونده) */}
        <ScheduledTxsCard />

        <Card title="خروجی داده‌ها">
          <div className="export-grid">
            <button
              className="btn-secondary"
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
              <svg>
                <use href="#i-download" />
              </svg>
              پشتیبان JSON
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const csv = transactionsToCsv(
                  sortTxDesc(txs),
                  members.map((m) => ({ id: m.id, name: m.name })),
                  [
                    ...CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
                    ...customCategories.map((c) => ({ id: c.id, name: c.name })),
                  ],
                  (id) => accounts.find((a) => a.id === id)?.title ?? "",
                );
                downloadTextFile(csv, "khaneyar-transactions.csv");
                show("فایل CSV دانلود شد");
              }}
            >
              <svg>
                <use href="#i-download" />
              </svg>
              CSV (اکسل)
            </button>
            <button
              className="btn-secondary"
              onClick={() => {
                const xml = transactionsToExcelXml(
                  sortTxDesc(txs),
                  members.map((m) => ({ id: m.id, name: m.name })),
                  [
                    ...CATEGORIES.map((c) => ({ id: c.id, name: c.name })),
                    ...customCategories.map((c) => ({ id: c.id, name: c.name })),
                  ],
                  (id) => accounts.find((a) => a.id === id)?.title ?? "",
                );
                downloadTextFile(
                  xml,
                  "khaneyar-transactions.xls",
                  "application/vnd.ms-excel;charset=utf-8",
                );
                show("فایل Excel دانلود شد");
              }}
            >
              <svg>
                <use href="#i-download" />
              </svg>
              Excel
            </button>
          </div>
          <p className="modal-sub" style={{ marginTop: 10 }}>
            مبالغ در همه فرمت‌ها به تومان (ارز پایه) است.
          </p>
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

        <VersionCard />

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
              نسخه {toFa(APP_VERSION)}
            </p>
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
          <button className="settings-nav-row" onClick={() => setSection("profile")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-users" />
              </svg>
            </span>
            <div>
              <h4>پروفایل من</h4>
              <p>عکس، نام، تاریخ تولد و کد ملی</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>

          <button className="settings-nav-row" onClick={() => setSection("finance")}>
            <span className="settings-nav-icon">
              <svg>
                <use href="#i-wallet" />
              </svg>
            </span>
            <div>
              <h4>تنظیمات مالی</h4>
              <p>بودجه، واحد پول و خروجی داده</p>
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
              <p>اعضا، نسبت‌ها و دعوت</p>
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
              <p>تولدها و مناسبت‌ها</p>
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
              <p>تم، به‌روزرسانی و درباره</p>
            </div>
            <svg className="settings-nav-arrow">
              <use href="#i-arrow-l" />
            </svg>
          </button>
        </Card>

        <button className="btn-danger-block" onClick={logout}>
          خروج از حساب
        </button>

        <p className="version-tag">خانه یار · نسخه {toFa(APP_VERSION)}</p>
      </div>
    </section>
  );
}

/* کارت نسخه و به‌روزرسانی — وضعیت نسخه فعلی + بررسی دستی */
function VersionCard() {
  const { updateReady, applyUpdate, checkForUpdate } = usePwaUpdateState();
  const { show } = useToast();
  const [checking, setChecking] = useState(false);
  const [upToDate, setUpToDate] = useState(false);

  async function onCheck() {
    setChecking(true);
    try {
      const found = await checkForUpdate();
      if (!found) {
        setUpToDate(true);
        show("شما آخرین نسخه را دارید");
      }
    } catch {
      show("بررسی به‌روزرسانی ناموفق بود");
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card title="نسخه و به‌روزرسانی">
      <div className="version-status">
        <div className="version-info">
          <h4>نسخه {toFa(APP_VERSION)}</h4>
          <p>
            {updateReady
              ? "نسخه جدید آماده نصب است"
              : upToDate
                ? "شما آخرین نسخه را دارید"
                : "برای اطمینان، به‌روزرسانی را بررسی کن"}
          </p>
        </div>
        {updateReady ? (
          <button type="button" className="btn-primary" onClick={applyUpdate}>
            به‌روزرسانی
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={checking}
            onClick={() => void onCheck()}
          >
            {checking ? "…" : "بررسی"}
          </button>
        )}
      </div>
    </Card>
  );
}

/* ارتقا به نسخه‌ی پرمیوم — ورودی مشخص */
function PremiumCard() {
  const { show } = useToast();
  return (
    <div className="premium-card">
      <div className="premium-head">
        <span className="premium-crown">
          <svg>
            <use href="#i-crown" />
          </svg>
        </span>
        <div>
          <h4>خانه‌یار پرمیوم</h4>
          <p>قابلیت‌های بیشتر برای مدیریت مالی خانواده</p>
        </div>
      </div>
      <ul className="premium-features">
        <li>خروجی گزارش‌های کامل (Excel و CSV)</li>
        <li>بودجه‌بندی نامحدود دسته‌ها</li>
        <li>پشتیبانی اولویت‌دار</li>
      </ul>
      <button
        className="btn-primary btn-block"
        onClick={() => show("نسخه پرمیوم به‌زودی عرضه می‌شود — منتظر باشید")}
      >
        ارتقا به نسخه پرمیوم
      </button>
    </div>
  );
}

/* فهرست تراکنش‌های زمان‌بندی‌شده — تکرارشونده‌ها */
function ScheduledTxsCard() {
  const { txs, family, customCategories, members } = useApp();
  const cur = family?.currency ?? "تومان";

  const scheduled = useMemo(
    () => sortTxDesc(txs.filter((t) => t.repeat && t.repeat !== "none")),
    [txs],
  );

  const repeatFa: Record<string, string> = {
    weekly: "هفتگی",
    monthly: "ماهانه",
    yearly: "سالانه",
  };

  const resolveName = (id: string) =>
    CATEGORIES.find((c) => c.id === id)?.name ??
    customCategories.find((c) => c.id === id)?.name ??
    id;

  return (
    <Card title="تراکنش‌های زمان‌بندی‌شده">
      {scheduled.length ? (
        <div className="scheduled-list">
          {scheduled.map((t) => (
            <div className="scheduled-row" key={t.id}>
              <span className="scheduled-repeat">
                <svg>
                  <use href="#i-repeat" />
                </svg>
                {repeatFa[t.repeat] ?? t.repeat}
              </span>
              <b className="scheduled-title">
                {t.note || resolveName(t.category)}
              </b>
              <span className="scheduled-amount">
                {formatAmount(toDisplay(t.amount, cur))} {cur}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="modal-sub">
          تراکنش تکرارشونده‌ای ندارید — موقع ثبت تراکنش، «تکرار» را روی
          دوره‌ای بگذارید (قسط، حقوق، اجاره…).
        </p>
      )}
      <p className="modal-sub" style={{ marginTop: 8 }}>
        {members.length} عضو · {scheduled.length} تراکنش زمان‌بندی‌شده
      </p>
    </Card>
  );
}
