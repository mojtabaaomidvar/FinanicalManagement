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
import { AmountInput, Card, Field, Modal } from "@/shared/ui";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { ProfileCard } from "./ProfileCard";
import { EventsCard } from "./EventsCard";
import { MembersCard } from "./MembersCard";
import { AccountsCard } from "./AccountsCard";
import { CategoriesCard } from "./CategoriesCard";
import { LabelsCard } from "./LabelsCard";
import { ScheduledTxsCard } from "./ScheduledTxsCard";
import { SmsBridgeCard } from "./SmsBridgeCard";
import { SettingsSubPage } from "./SettingsSubPage";
import { SettingsCard, SettingsRow, type RowTrailing } from "./SettingsCard";
import { useTheme } from "@/app/providers/useTheme";
import { usePwaUpdateState } from "@/app/pwaUpdate.tsx";
import { APP_VERSION, buildId } from "@/shared/config/version";
import { toFa } from "@/shared/lib/digits";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import {
  transactionsToCsv,
  transactionsToExcelXml,
  downloadTextFile,
} from "@/shared/lib/csv";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { CATEGORIES } from "@/domain/category/category.catalog";
import type { ThemeMode } from "@/domain/family/family.types";
import { relationLabel } from "@/domain/family/family.rules";

type SettingsSection =
  | "profile"
  | "premium"
  | "family"
  | "events"
  | "accounts"
  | "scheduled"
  | "categories"
  | "labels"
  | "export"
  | "sms"
  | "about"
  | "update";

/* ترتیب سگمنت «ظاهر» — روشن → خودکار → تیره */
const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "روشن" },
  { value: "auto", label: "خودکار" },
  { value: "dark", label: "تیره" },
];

/* آیکون هر حالت ظاهر — خورشید/نیمه/ماه */
const THEME_ICON: Record<ThemeMode, string> = {
  light: "sun",
  auto: "auto-theme",
  dark: "moon",
};

export function SettingsPage() {
  const {
    useCases,
    family,
    members,
    txs,
    accounts,
    events,
    member,
    budgets,
    customCategories,
    subcategories,
    cur,
    refreshData,
    updateMember,
    onLoggedOut,
  } = useApp();
  const { show } = useToast();
  const { themeMode, changeTheme } = useTheme(member, useCases);
  const { updateReady, applyUpdate } = usePwaUpdateState();

  const [section, setSection] = useState<SettingsSection | null>(null);

  const isOwner = member?.role === "owner";

  /* بودجه ماهانه دیگر زیرصفحه ندارد — فقط همین مودال ورود/ویرایش مبلغ */
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);
  /* کلید پل پیامک ساخته شده یا نه — تعیین‌کننده حالت ردیف (واژه «ساخت کلید») */
  const [bridgeOn, setBridgeOn] = useState<boolean | null>(null);
  /* مقدار خوش‌بینانه کلید «ریال» تا وقتی پاسخ سرور برسد — وگرنه کلید
     تا پایان رفت‌وبرگشت شبکه تکان نمی‌خورد و کاربر دوباره می‌زند */
  const [pendingRial, setPendingRial] = useState<boolean | null>(null);

  useEffect(() => {
    setBudget(
      family?.budget ? formatAmount(toDisplay(family.budget, cur)) : "",
    );
  }, [family?.budget, cur]);

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

  /* مجموع بودجهٔ دسته‌ها (پایه: تومان) — سقف ماهانه نباید از آن کمتر بماند */
  const categoryBudgetSum = useMemo(
    () => budgets.reduce((s, b) => s + b.amount, 0),
    [budgets],
  );

  /** ذخیره سقف بودجه ماهانه — فقط مبلغ؛ واحد پول از کلید همین صفحه می‌آید */
  async function saveBudget() {
    if (!family) return;
    setSaving(true);
    try {
      await useCases!.setMonthlyBudget.execute(
        fromDisplay(parseAmountInput(budget), cur),
      );
      await refreshData();
      setBudgetOpen(false);
      show("بودجه ماهانه ذخیره شد");
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setSaving(false);
    }
  }

  /** کلید «نمایش به ریال» — واحد نمایشِ خودِ همین کاربر (v5.8).
      مبالغ در سرور همیشه به تومان (ارز پایه) ذخیره می‌مانند و این کلید
      روی بقیه اعضای خانواده اثری ندارد. عضو به‌روزشده مستقیم در
      updateMember نشسته می‌شود چون refreshData هرگز member را تازه نمی‌کند. */
  async function toggleRial(toRial: boolean) {
    if (pendingRial !== null) return;
    setPendingRial(toRial);
    try {
      const updated = await useCases!.setCurrency.execute(
        toRial ? "ریال" : "تومان",
      );
      updateMember(updated);
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

  /* §۶.۲ — تابع wipeDevice بازنشسته شد (ردیفش از UI حذف شد چون با «حذف
     حساب» اشتباه گرفته می‌شد). کد بدون حذف نگه داشته می‌شود تا اگر بعداً
     «پاک‌سازی دستگاه» لازم شد، از همین‌جا بازگردد:

     async function wipeDevice() {
       if (!confirm("خروج + پاک‌کردن حافظه موقت و نسخه آفلاین این دستگاه؛
         داده روی سرور دست‌نخورده می‌ماند. ادامه؟")) return;
       try { await useCases!.logout.execute(); } catch { بی‌صدا }
       try { localStorage.clear(); sessionStorage.clear(); } catch { خصوصی }
       try {
         if ("caches" in window) {
           const keys = await caches.keys();
           await Promise.all(keys.map((k) => caches.delete(k)));
         }
         const regs = await navigator.serviceWorker?.getRegistrations?.();
         await Promise.all((regs ?? []).map((r) => r.unregister()));
       } catch { بی‌صدا }
       onLoggedOut();
       location.reload();
     }
  */

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

  /* بازگشتِ دکمه/سوایپ در زیرصفحهٔ باز = برگشت به فهرست تنظیمات */
  useBackGuard(section !== null, back);

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

  if (section === "categories") {
    return (
      <SettingsSubPage title="دسته‌ها" onBack={back}>
        <CategoriesCard />
      </SettingsSubPage>
    );
  }

  if (section === "labels") {
    return (
      <SettingsSubPage title="برچسب‌ها" onBack={back}>
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
                    ...customCategories.map((c) => ({
                      id: c.id,
                      name: c.name,
                    })),
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
                    ...customCategories.map((c) => ({
                      id: c.id,
                      name: c.name,
                    })),
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

  /* ── به‌روزرسانی — جدا از «درباره» (طبق بریف §۶.۱) ── */
  if (section === "update") {
    return (
      <SettingsSubPage title="به‌روزرسانی" onBack={back}>
        <VersionCard />
      </SettingsSubPage>
    );
  }

  /* ── درباره — فقط هویت برنامه؛ به‌روزرسانی زیرصفحهٔ جداست ── */
  if (section === "about") {
    return (
      <SettingsSubPage title="درباره" onBack={back}>
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
            {/* شناسه ساخت — با این می‌شود مطمئن شد نسخه روی دستگاه همان
                نسخه‌ای است که تازه منتشر کرده‌اید */}
            <p style={{ fontSize: 10, color: "var(--text-3)", marginTop: 4 }}>
              شناسه ساخت: {toFa(buildId())}
            </p>
          </div>
        </Card>
      </SettingsSubPage>
    );
  }

  /* ─────────────── فهرست اصلی ─────────────── */
  const themeIdx = Math.max(
    0,
    THEMES.findIndex((t) => t.value === themeMode),
  );

  /* واحدی که همین حالا زیر کلید نوشته می‌شود — تا پاسخ سرور برسد،
     مقدار خوش‌بینانه کلید ملاک است تا متن با کلید همگام بماند */
  const shownCur = pendingRial === null ? cur : pendingRial ? "ریال" : "تومان";

  /* سقفی که کاربر همین حالا در مودال تایپ کرده، از مجموع دسته‌ها کمتر است؟ */
  const budgetBelowSum =
    categoryBudgetSum > 0 &&
    fromDisplay(parseAmountInput(budget), cur) < categoryBudgetSum;

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
              <span className="set-profile-name">
                {member?.name ?? "کاربر"}
              </span>
              <span className="set-profile-sub">
                {/* نسبت با مدیر خانواده — همان برچسبی که در پنل پروفایل و
                    فهرست اعضا دیده می‌شود، تا همه‌جا یکسان باشد */}
                {member ? relationLabel(member) : "کاربر"}
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
            label="نسخه پرمیوم"
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
            label="رویدادهای مهم خانواده"
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
            onClick={() => setBudgetOpen(true)}
          />
          {/* واحد پول شخصی است (v5.8) — هر عضو، از جمله اعضای عادی،
              واحد نمایش خودش را عوض می‌کند و روی بقیه اثری ندارد */}
          <SettingsRow
            icon="swap"
            label="واحد پول"
            sub={`${shownCur}`}
            trailing={{
              type: "toggle",
              on: pendingRial ?? cur === "ریال",
              onChange: (next) => void toggleRial(next),
            }}
          />
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
            label="دسته‌ها"
            trailing={
              customCategories.length
                ? { type: "counter", count: customCategories.length }
                : { type: "action", label: "افزودن" }
            }
            onClick={() => setSection("categories")}
          />
          <SettingsRow
            icon="tag"
            label="برچسب‌ها"
            trailing={
              subcategories.length
                ? { type: "counter", count: subcategories.length }
                : { type: "action", label: "افزودن" }
            }
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
          {/* ظاهر — سه‌گزینه‌ای با آیکون؛ گزینهٔ فعال کپسول لغزنده دارد.
             استپر بالا/پایین قبلی جای زیادی می‌گرفت و ترتیبش گنگ بود. */}
          <div className="set-row set-theme-row">
            <span className="set-row-ico">
              <svg>
                <use href="#i-image" />
              </svg>
            </span>
            <span className="set-row-body">
              <span className="set-row-label">ظاهر</span>
              <span className="set-row-sub">
                {themeMode === "auto"
                  ? "خودکار بر اساس ساعت شبانه‌روز"
                  : themeMode === "dark"
                    ? "تم تیره همیشه روشن است"
                    : "تم روشن همیشه فعال است"}
              </span>
            </span>
            <div
              className="set-theme-seg"
              role="radiogroup"
              aria-label="انتخاب ظاهر"
            >
              <span
                className="set-theme-pill"
                aria-hidden="true"
                style={{ insetInlineStart: `calc(${themeIdx} * 33.333% + 3px)` }}
              />
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={themeMode === t.value}
                  className={`set-theme-opt ${themeMode === t.value ? "active" : ""}`}
                  aria-label={t.label}
                  title={t.label}
                  onClick={() => void changeTheme(t.value)}
                >
                  <svg>
                    <use href={`#i-${THEME_ICON[t.value]}`} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <SettingsRow
            icon="sms"
            label="پیامک خودکار (اندروید)"
            sub="ثبت خودکار پیامک‌های بانکی"
            trailing={smsTrailing}
            onClick={() => setSection("sms")}
          />
          {/* به‌روزرسانی و درباره دو ردیفِ جدا شدند (§۶.۱): وقتی نسخهٔ
              تازه آماده است، ردیف به‌روزرسانی خودش «نصب» را نشان می‌دهد. */}
          <SettingsRow
            icon="download"
            label="به‌روزرسانی"
            trailing={
              updateReady
                ? { type: "action", label: "نصب" }
                : { type: "value", value: `نسخه ${toFa(APP_VERSION)}` }
            }
            onClick={() => (updateReady ? applyUpdate() : setSection("update"))}
          />
          <SettingsRow
            icon="home-i"
            label="درباره"
            trailing={{ type: "chevron" }}
            onClick={() => setSection("about")}
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

        {/* §۶.۲ — ردیف «پاک‌کردن داده‌های این دستگاه» حذف شد: کاربران آن
            را با «حذف حساب» اشتباه می‌گرفتند و بی‌دلیل نگران می‌شدند.
            «خروج از حساب» بالا برای پایان نشست کافی است. تابع wipeDevice
            بازنشسته شد (بدون حذف کد — رجوع به تعریفش). */}

        <p className="set-version">نسخه {toFa(APP_VERSION)}</p>
      </div>

      {/* بودجه ماهانه — مودال ورود/ویرایش مبلغ (زیرصفحه‌ای در کار نیست) */}
      <Modal
        open={budgetOpen}
        onClose={() => setBudgetOpen(false)}
        title="بودجه ماهانه"
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <Field label={`سقف ماهانه (${cur})`}>
              <AmountInput value={budget} onChange={setBudget} currency={cur} />
            </Field>
          </div>
        </div>

        {/* مجموع بودجهٔ دسته‌ها هرگز نباید از سقف ماهانه بیشتر باشد */}
        {categoryBudgetSum > 0 ? (
          <p
            className={`modal-sub${budgetBelowSum ? " danger-text" : ""}`}
            style={{ marginTop: 6 }}
          >
            مجموع بودجه‌بندی دسته‌ها:{" "}
            {formatAmount(toDisplay(categoryBudgetSum, cur))} {cur}
            {budgetBelowSum
              ? " — سقف واردشده از این مجموع کمتر است؛ در تب بودجه‌ها هشدار می‌گیرید."
              : ""}
          </p>
        ) : null}

        {budgetStatus ? (
          <div style={{ marginTop: 10 }}>
            <CheckBudgetStatus status={budgetStatus} currency={cur} />
          </div>
        ) : null}

        {isOwner ? (
          <div className="modal-actions">
            <button
              className="btn-secondary"
              onClick={() => setBudgetOpen(false)}
            >
              انصراف
            </button>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => void saveBudget()}
            >
              {saving ? "…" : "ذخیره"}
            </button>
          </div>
        ) : (
          <p className="modal-sub" style={{ marginTop: 10 }}>
            فقط مدیر خانواده می‌تواند سقف بودجه را تغییر دهد.
          </p>
        )}
      </Modal>
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
      {/* شناسه ساخت نسخه‌ای که همین حالا روی دستگاه اجرا می‌شود */}
      <p className="modal-sub" style={{ marginTop: 10 }}>
        شناسه ساخت: {toFa(buildId())}
      </p>
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

/* فهرست تراکنش‌های زمان‌بندی‌شده به فایل جداگانه ./ScheduledTxsCard منتقل
   شد؛ آنجا علاوه بر فهرست، فرم افزودن با «پریود» و «تاریخ پایان» اجباری
   هم دارد. نسخهٔ محلی قبلی عمداً حذف شد تا دو منبع حقیقت نداشته باشیم. */
