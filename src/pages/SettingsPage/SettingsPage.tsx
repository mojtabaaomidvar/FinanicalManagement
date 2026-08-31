/* صفحه تنظیمات — اعضا، دعوت، بودجه، تم، خروجی، خروج */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card } from "@/shared/ui";
import { InviteFeature } from "@/features/invite";
import { CheckBudgetStatus } from "./CheckBudgetStatus";
import { formatAmount, liveFormatAmount } from "@/shared/lib/format";

export function SettingsPage() {
  const { useCases, family, members, txs, onLoggedOut } = useApp();
  const { show } = useToast();

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

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>تنظیمات</h1>
          <p>شخصی‌سازی اپلیکیشن</p>
        </div>
      </header>

      <div className="content">
        <Card
          title="اعضای خانواده"
          action={
            <span className="badge">کد: {family?.code ?? "—"}</span>
          }
        >
          <div className="settings-members">
            {members.map((m) => (
              <div className="settings-member" key={m.id}>
                <span className="member-avatar">{m.name.charAt(0)}</span>
                <div>
                  <h5>{m.name}</h5>
                  <p>{m.role === "owner" ? "مدیر خانواده" : "عضو"}</p>
                </div>
              </div>
            ))}
          </div>

          <InviteFeature />
        </Card>

        <Card>
          <div className="setting-row">
            <div>
              <h4>بودجه ماهانه</h4>
              <p>سقف هزینه‌های ماه (تومان)</p>
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

        <Card>
          <div className="setting-row">
            <div>
              <h4>حالت تیره</h4>
              <p>تغییر ظاهر اپلیکیشن</p>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={family?.dark ?? true}
                onChange={(e) => {
                  /* اعمال فوری تم + ذخیره */
                  const dark = e.target.checked;
                  document.documentElement.dataset.theme = dark ? "dark" : "light";
                  saveSettings({ dark });
                }}
              />
              <span className="slider" />
            </label>
          </div>
          <div className="setting-row">
            <div>
              <h4>نمایش مبالغ</h4>
              <p>واحد نمایش مبالغ</p>
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

        <Card>
          <div className="setting-row">
            <div>
              <h4>خروجی داده‌ها</h4>
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
                  "mali-man-backup-" +
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

        <p className="version-tag">
          نسخه ۴.۲.۰ — React + Clean Architecture
        </p>
      </div>
    </section>
  );
}
