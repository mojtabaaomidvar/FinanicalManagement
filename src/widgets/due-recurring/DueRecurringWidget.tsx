/* ویجت سررسید تراکنش‌های تکرارشونده (بخش ۳.۲) — فقط برای مدیر خانواده.
   برای هر تراکنش تکرارشونده، سررسیدهای رسیدگی‌نشده تا امروز محاسبه می‌شوند
   و از مدیر پرسیده می‌شود «انجام شد؟». پاسخ بله فرم را با مبلغ/دسته/توضیح
   الگو پیش‌پر می‌کند (تاریخ روی امروز است تا کاربر خودش نهایی کند)؛ پاسخ نه
   همان سررسید را علامت رسیدگی می‌زند تا دوباره پرسیده نشود. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { pendingDueList } from "@/domain/transaction/recurring.rules";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { formatLong, isoToJalali, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { TxFormModel } from "@/features/transaction-form";

interface DueItem {
  tx: Transaction;
  dueDate: string; /* ISO میلادی */
  label: string; /* تاریخ سررسید به‌صورت خوانا */
}

const MAX_SHOWN = 6;

export function DueRecurringWidget({ form }: { form: TxFormModel }) {
  const { txs, member, cur, customCategories, useCases, refreshData } =
    useApp();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  /* همهٔ سررسیدهای رسیدگی‌نشده تا امروز، مرتب از قدیمی‌ترین.
     حلقه‌اش از خودِ دامنهٔ تراکنش می‌آید (`pendingDueList`) — همان تابعی که
     هستهٔ اعلانِ §۷ هم از آن می‌خواند. پیش از این هر دو حلقهٔ خودشان را
     داشتند و می‌توانستند درّه بردارند: کاربر موردی را در زنگِ اعلان می‌دید
     و این‌جا نه. افقِ «امروز» عمدی است و رفتارِ قبلیِ همین ویجت را نگه
     می‌دارد — این ویجت از مدیر می‌پرسد «انجام شد؟»، پس نباید دربارهٔ
     تاریخی بپرسد که هنوز نرسیده. */
  const items = useMemo<DueItem[]>(() => {
    const now = today();
    return pendingDueList(txs, now).map((d) => ({
      tx: d.tx,
      dueDate: d.dueIso,
      label: formatLong(isoToJalali(d.dueIso)),
    }));
  }, [txs]);

  /* فقط مدیر خانواده رسیدگی می‌کند */
  if (member?.role !== "owner" || items.length === 0) return null;

  const shown = items.slice(0, MAX_SHOWN);

  /* «نه» — این سررسید بدون ثبت تراکنش علامت رسیدگی می‌خورد */
  async function skip(item: DueItem) {
    if (!useCases || busy) return;
    setBusy(item.tx.id + item.dueDate);
    try {
      await useCases.markRecurringOccurrence.execute(item.tx.id, item.dueDate);
      await refreshData();
    } catch {
      /* بی‌صدا — دوباره در فهرست می‌ماند */
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="strip due-rec">
      <div className="strip-head">
        <h3 className="strip-title">سررسید تراکنش‌های تکرارشونده</h3>
        <span className="strip-hint">{toFa(items.length)} مورد</span>
      </div>

      <div className="due-list">
        {shown.map((item) => {
          const cat = resolve(item.tx.category);
          const isBusy = busy === item.tx.id + item.dueDate;
          return (
            <div className="due-item" key={item.tx.id + item.dueDate}>
              <span className={`due-ico ${item.tx.type}`}>
                <svg>
                  <use href={`#${cat.icon}`} />
                </svg>
              </span>
              <div className="due-info">
                <b>{item.tx.note?.trim() || cat.name}</b>
                <p>
                  {item.label} · {formatAmount(toDisplay(item.tx.amount, cur))}
                </p>
              </div>
              <div className="due-actions">
                <button
                  type="button"
                  className="due-yes"
                  disabled={isBusy}
                  onClick={() => form.openForOccurrence(item.tx, item.dueDate)}
                >
                  ثبت شد
                </button>
                <button
                  type="button"
                  className="due-no"
                  disabled={isBusy}
                  onClick={() => skip(item)}
                >
                  نه
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
