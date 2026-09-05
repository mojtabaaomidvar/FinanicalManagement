/* صفحه «تنظیمات / بیشتر» — الگوی گروه‌بندی‌شده (Grouped Settings)
   ═══════════════════════════════════════════════════════════════
   پس‌زمینه خاکستری روشن، عنوان بزرگ، و چند کارت سفید جدا از هم که
   هرکدام یک گروه منطقی‌اند (۲ تا ۴ ردیف). داخل کارت خط جداکننده
   نداریم؛ جدایی فقط با فاصله. ردیف‌ها از SettingsCard/SettingsRow
   می‌آیند و حالت انتهایی‌شان (فلش/شمارنده/مقدار/کلید/واژه/استپر)
   با prop انتخاب می‌شود.

   ناوبری همان الگوی hub-and-spoke قبلی است: هر ردیف یک زیرصفحه باز
   می‌کند. زیرصفحه «تنظیمات مالی» قبلی به چهار زیرصفحه ریز شد تا هر
   ردیف یک مقصد روشن داشته باشد. */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card } from "@/shared/ui";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { ProfileCard } from "./ProfileCard";
import { EventsCard } from "./EventsCard";
import { MembersCard } from "./MembersCard";
import { AccountsCard } from "./AccountsCard";
import { LabelsCard } from "./LabelsCard";
import { SmsBridgeCard } from "./SmsBridgeCard";
import { SettingsSubPage } from "./SettingsSubPage";
import { SettingsCard, SettingsRow, type RowTrailing } from "./SettingsCard";
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
import { isoToJalali, formatISO } from "@/shared/lib/jalali";
import type { ThemeMode } from "@/domain/family/family.types";

type SettingsSection =
  | "profile"
  | "premium"
  | "family"
  | "events"
  | "budget"
  | "accounts"
  | "scheduled"
  | "labels"
  | "export"
  | "sms"
  | "about";

/* ترتیب استپر «ظاهر» — روشن → خودکار → تیره */
const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "auto", label: "خودکار" },
  { value: "dark", label: "تیره" },
];

export function SettingsPage() {
  const {
    useCases,
    family,
    members,
    txs,
    accounts,
    events,
    member,
    customCategories,
    subcategories,
    refreshData,
    onLoggedOut,
  } = useApp();
  const { show } = useToast();
  const { themeMode, changeTheme } = useTheme(member, useCases);
  const { updateReady, applyUpdate } = usePwaUpdateState();

  const [section, setSection] = useState<SettingsSection | null>(null);

  const [budget, setBudget] = useState("");
  const [currency, setCurrency] = useState("تومان");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /* کلید پل پیامک ساخته شده یا نه — تعیین‌کننده حالت ردیف (واژه «ساخت کلید») */
  const [bridgeOn, setBridgeOn] = useState<boolean | null>(null);
  /* مقدار خوش‌بینانه کلید «ریال» تا وقتی پاسخ سرور برسد — وگرنه کلید
     تا پایان رفت‌وبرگشت شبکه تکان نمی‌خورد و کاربر دوباره می‌زند */
  const [pendingRial, setPendingRial] = useState<boolean | null>(null);

  useEffect(() => {
    setBudget(
      family?.budget
        ? formatAmount(toDisplay(family.budget, family?.currency ?? "تومان"))
        : "",
    );
    setCurrency(family?.currency ?? "تومان");
    setDirty(false);
  }, [family?.budget, family?.currency]);

  /* وضعیت پل پیامک — هربار که به فهرست اصلی برمی‌گردیم تازه می‌شود،
     چون ممکن است کاربر همین الان در زیرصفحه کلید ساخته باشد */
  useEffect(() => {
    if (section !== null || !useCases) return;
    let alive = true;
    useCases.getBridge
      .execute()
      .then((b) => {
        if (alive) setBridgeOn(!!b?.token);
      })
      .catch(() => {
        if (alive) setBridgeOn(false);
      });
    return () => {
      alive = false;
    };
  }, [useCases, section]);

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

  /** کلید «نمایش به ریال» — فقط واحد نمایش عوض می‌شود؛
      بودجه در سرور همیشه به تومان (ارز پایه) ذخیره است */
  async function toggleRial(toRial: boolean) {
    if (!family || pendingRial !== null) return;
    setPendingRial(toRial);
    try {
      await useCases!.updateFamilySettings.execute({
        budget: family.budget,
        currency: toRial ? "ریال" : "تومان",
        dark: family.dark,
      });
      await refreshData();
      show(
        toRial
          ? "مبالغ به ریال نمایش داده می‌شوند"
          : "مبالغ به تومان نمایش داده می‌شوند",
      );
    } catch (e) {
      show((e as Error).message || "خطا در تغییر واحد پول");
    } finally {
      setPendingRial(null);
    }
  }

  async function logout() {
    try {
      await useCases!.logout.execute();
    } catch {
      /* حتی اگر سرور پاسخ نداد، نشست محلی باید بسته شود */
    }
    onLoggedOut();
    location.reload();
  }

  /** ناحیه خطر — خروج + پاک‌کردن حافظه محلی/آفلاین این دستگاه.
      داده روی سرور دست‌نخورده می‌ماند؛ فقط این دستگاه تمیز می‌شود. */
  async function wipeDevice() {
    if (
      !confirm(
        "از حساب خارج می‌شوید و حافظه موقت و نسخه آفلاین روی این دستگاه پاک می‌شود.\nداده‌های شما روی سرور دست‌نخورده می‌ماند. ادامه؟",
      )
    ) {
      return;
    }
    try {
      await useCases!.logout.execute();
    } catch {
      /* بی‌صدا — پاک‌سازی محلی مهم‌تر است */
    }
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* حالت خصوصی مرورگر */
    }
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((r) => r.unregister()));
    } catch {
      /* بی‌صدا */
    }
    onLoggedOut();
    location.reload();
  }

  const budgetStatus = useMemo(
    () =>
      useCases && family
        ? useCases.checkBudgetStatus.execute(family.budget, txs)
        : null,
    [useCases, family, txs],
  );

  const scheduledCount = useMemo(
    () => txs.filter((t) => t.repeat && t.repeat !== "none").length,
    [txs],
  );

  const back = () => setSection(null);

  /* ─────────────── زیرصفحه‌ها ─────────────── */
  if (section === "profile") {
    return (
      <SettingsSubPage title="پروفایل من" onBack={back}>
        <ProfileCard />
      </SettingsSubPage>
    );
  }

  if (section === "premium") {
    return (
      <SettingsSubPage title="نسخه ویژه" onBack={back}>
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

  if (section === "accounts") {
    return (
      <SettingsSubPage title="کارت‌ها و حساب‌ها" onBack={back}>
        <AccountsCard />
      </SettingsSubPage>
    );
  }

  if (section === "scheduled") {
    return (
      <SettingsSubPage title="تراکنش‌های تکرارشونده" onBack={back}>
        <ScheduledTxsCard />
      </SettingsSubPage>
    );
  }

  if (section === "labels") {
    return (
      <SettingsSubPage title="دسته‌ها و برچسب‌ها" onBack={back}>
        <LabelsCard />
      </SettingsSubPage>
    );
  }

  if (section === "sms") {
    return (
      <SettingsSubPage title="پیامک خودکار" onBack={back}>
        <SmsBridgeCard />
      </SettingsSubPage>
    );
  }

  /* ── بودجه ماهانه و واحد پول ── */
  if (section === "budget") {
    const isOwner = member?.role === "owner";
    return (
      <SettingsSubPage title="بودجه و واحد پول" onBack={back}>
        <Card>
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">بودجه ماهانه</label>
              <div className="amt-field">
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
                <span className="cur-suffix">{currency}</span>
              </div>
            </div>
            <div className="form-row">
              <label className="form-label">واحد پول</label>
              <select
                className="select-input"
                value={currency}
                disabled={!isOwner}
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
            <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }}>
              تغییر بودجه ماهانه فقط توسط مدیر خانواده امکان‌پذیر است
            </p>
          ) : null}
          <CheckBudgetStatus status={budgetStatus} currency={currency} />
          <button
            className="btn-primary btn-block"
            style={{ marginTop: 12 }}
            disabled={!dirty || saving || !isOwner}
            onClick={applyFinanceSettings}
          >
            {saving ? "…" : dirty ? "اعمال تغییرات" : "ذخیره شد"}
          </button>
        </Card>
      </SettingsSubPage>
    );
  }

  /* ── خروجی گرفتن از داده‌ها ── */
  if (section === "export") {
    return (
      <SettingsSubPage title="خروجی داده‌ها" onBack={back}>
        <Card title="فرمت خروجی">
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

  /* ── درباره و به‌روزرسانی ── */
  if (section === "about") {
    return (
      <SettingsSubPage title="درباره و به‌روزرسانی" onBack={back}>
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

  /* ─────────────── فهرست اصلی ─────────────── */
  const cur = family?.currency ?? "تومان";
  const isOwner = member?.role === "owner";
  const themeIdx = Math.max(
    0,
    THEMES.findIndex((t) => t.value === themeMode),
  );
  const labelCount = customCategories.length + subcategories.length;

  /* بودجه: مقدار، یا واژه «تعیین» وقتی هنوز صفر است */
  const budgetTrailing: RowTrailing = family?.budget
    ? {
        type: "value",
        value: `${formatAmount(toDisplay(family.budget, cur))} ${cur}`,
      }
    : { type: "action", label: "تعیین" };

  /* کارت‌ها: شمارنده، یا واژه «افزودن» وقتی هیچ کارتی ثبت نشده */
  const accountsTrailing: RowTrailing = accounts.length
    ? { type: "counter", count: accounts.length }
    : { type: "action", label: "افزودن" };

  /* پیامک: تا وقتی وضعیت نیامده، ردیف ساده؛ بعد «فعال» یا «ساخت کلید» */
  const smsTrailing: RowTrailing =
    bridgeOn === null
      ? { type: "chevron" }
      : bridgeOn
        ? { type: "value", value: "فعال" }
        : { type: "action", label: "ساخت کلید" };

  return (
    <section className="page active">
      <header className="app-header set-hero">
        <div className="header-title">
          <h1>تنظیمات</h1>
        </div>
      </header>

      <div className="content set-page">
        {/* ── کارت ویژه بالا: پروفایل + ارتقا ── */}
        <SettingsCard>
          <button
            type="button"
            className="set-row set-row-profile"
            onClick={() => setSection("profile")}
          >
            <span className="set-avatar">
              {member?.avatarUrl ? (
                <img src={member.avatarUrl} alt={member.name} />
              ) : (
                (member?.name?.trim()?.[0] ?? "؟")
              )}
            </span>
            <span className="set-row-body">
              <span className="set-profile-name">{member?.name ?? "کاربر"}</span>
              <span className="set-profile-sub">
                {member?.phone ??
                  (member?.role === "owner" ? "مدیر خانواده" : "عضو خانواده")}
              </span>
            </span>
            <span className="set-row-trail">
              <svg className="set-chev">
                <use href="#i-arrow-l" />
              </svg>
            </span>
          </button>

          <SettingsRow
            icon="crown"
            label="ارتقا به نسخه ویژه!"
            sub="قابلیت‌های بیشتر برای مدیریت مالی خانواده"
            tone="gold"
            trailing={{ type: "chevron" }}
            onClick={() => setSection("premium")}
          />
        </SettingsCard>

        {/* ── خانواده ── */}
        <SettingsCard title="خانواده">
          <SettingsRow
            icon="users"
            label="اعضای خانواده"
            trailing={{ type: "counter", count: members.length }}
            onClick={() => setSection("family")}
          />
          <SettingsRow
            icon="bell"
            label="رویدادهای مهم"
            trailing={{ type: "counter", count: events.length }}
            onClick={() => setSection("events")}
          />
        </SettingsCard>

        {/* ── پول و بودجه ── */}
        <SettingsCard title="پول و بودجه">
          <SettingsRow
            icon="piggy"
            label="بودجه ماهانه"
            trailing={budgetTrailing}
            onClick={() => setSection("budget")}
          />
          {isOwner ? (
            <SettingsRow
              icon="swap"
              label="نمایش مبالغ به ریال"
              sub="واحد پایه همیشه تومان می‌ماند"
              trailing={{
                type: "toggle",
                on: pendingRial ?? cur === "ریال",
                onChange: (next) => void toggleRial(next),
              }}
            />
          ) : (
            <SettingsRow
              icon="swap"
              label="واحد نمایش مبالغ"
              trailing={{ type: "value", value: cur }}
            />
          )}
          <SettingsRow
            icon="card"
            label="کارت‌ها و حساب‌ها"
            trailing={accountsTrailing}
            onClick={() => setSection("accounts")}
          />
        </SettingsCard>

        {/* ── تراکنش‌ها و داده‌ها ── */}
        <SettingsCard title="تراکنش‌ها و داده‌ها">
          <SettingsRow
            icon="repeat"
            label="تراکنش‌های تکرارشونده"
            trailing={{ type: "counter", count: scheduledCount }}
            onClick={() => setSection("scheduled")}
          />
          <SettingsRow
            icon="tag"
            label="دسته‌ها و برچسب‌ها"
            trailing={{ type: "counter", count: labelCount }}
            onClick={() => setSection("labels")}
          />
          <SettingsRow
            icon="download"
            label="خروجی گرفتن از داده‌ها"
            trailing={{ type: "chevron" }}
            onClick={() => setSection("export")}
          />
        </SettingsCard>

        {/* ── برنامه ── */}
        <SettingsCard title="برنامه">
          <SettingsRow
            icon="image"
            label="ظاهر"
            trailing={{
              type: "stepper",
              value: THEMES[themeIdx].label,
              canDown: themeIdx > 0,
              canUp: themeIdx < THEMES.length - 1,
              onStep: (dir) => {
                const next = THEMES[themeIdx + dir];
                if (next) void changeTheme(next.value);
              },
            }}
          />
          <SettingsRow
            icon="sms"
            label="پیامک خودکار (اندروید)"
            sub="ثبت خودکار پیامک‌های بانکی"
            trailing={smsTrailing}
            onClick={() => setSection("sms")}
          />
          <SettingsRow
            icon="gear"
            label="درباره و به‌روزرسانی"
            trailing={
              updateReady
                ? { type: "action", label: "نصب" }
                : { type: "value", value: `نسخه ${toFa(APP_VERSION)}` }
            }
            onClick={() => (updateReady ? applyUpdate() : setSection("about"))}
          />
        </SettingsCard>

        {/* ── ناحیه حساب و خطر — هرکدام کارت تک‌ردیفه جدا ── */}
        <SettingsCard>
          <SettingsRow
            icon="logout"
            label="خروج از حساب"
            trailing={{ type: "chevron" }}
            onClick={() => void logout()}
          />
        </SettingsCard>

        <SettingsCard>
          <SettingsRow
            icon="trash"
            label="پاک‌کردن داده‌های این دستگاه"
            sub="خروج + حذف حافظه موقت و نسخه آفلاین"
            trailing={{ type: "chevron" }}
            danger
            onClick={() => void wipeDevice()}
          />
        </SettingsCard>

        <p className="set-version">نسخه {toFa(APP_VERSION)}</p>
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
                {t.repeatEnd
                  ? ` تا ${formatISO(isoToJalali(t.repeatEnd))}`
                  : ""}
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
