/* ویجت سررسید تراکنش‌های تکرارشونده (بخش ۳.۲) — فقط برای مدیر خانواده.
   برای هر تراکنش تکرارشونده، سررسیدهای رسیدگی‌نشدهٔ امروز و فردا نمایش داده می‌شوند
   و از مدیر پرسیده می‌شود «انجام شد؟». پاسخ بله فرم را با مبلغ/دسته/توضیح
   الگو پیش‌پر می‌کند (تاریخ روی امروز است تا کاربر خودش نهایی کند)؛ پاسخ نه
   همان سررسید را علامت رسیدگی می‌زند تا دوباره پرسیده نشود. */

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { buildCategoryResolver } from "@/domain/category/resolve";
import { reminderDueList } from "@/domain/transaction/recurring.rules";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { formatLong, isoToJalali } from "@/shared/lib/jalali";
import { useTehranDay } from "@/shared/lib/useTehranDay";
import { formatExpressionValue } from "@/shared/ui";
import { CurrencyUnit } from "@/shared/ui/CurrencyUnit";
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
  const [notice, setNotice] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(MAX_SHOWN);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const memberId = useRef(member?.id); memberId.current = member?.id;
  const { todayJ } = useTehranDay();

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );

  /* همان بازهٔ امروز و فردا در مرکز اعلان؛ تاریخ تهران با گذشت روز تازه می‌شود. */
  const items = useMemo<DueItem[]>(() => {
    return reminderDueList(txs, todayJ).map((d) => ({
      tx: d.tx,
      dueDate: d.dueIso,
      label: formatLong(isoToJalali(d.dueIso)),
    }));
  }, [txs, todayJ]);

  /* فقط مدیر خانواده رسیدگی می‌کند */
  if ((member?.role !== "owner" && member?.role !== "admin") || items.length === 0) return null;

  const shown = items.slice(0, shownCount);

  /* «نه» — این سررسید بدون ثبت تراکنش علامت رسیدگی می‌خورد */
  async function skip(item: DueItem) {
    if (!useCases || writing.current || form.busy || form.open) return;
    if (!confirm(/* @copy-text recurring.skip */ `نوبت «${item.tx.note?.trim() || resolve(item.tx.category).name}» در ${item.label} رد شود؟ هزینه یا درآمدی ثبت نمی‌شود و یادآوری این نوبت بسته می‌شود.`)) return;
    writing.current = true;
    const actor = memberId.current;
    const current = () => mounted.current && memberId.current === actor;
    setBusy(item.tx.id + item.dueDate);
    setNotice(null);
    let skipped = false;
    try {
      await useCases.markRecurringOccurrence.execute(item.tx.id, item.dueDate);
      if (!current()) return;
      skipped = true;
      await refreshData();
    } catch (error) {
      if (current()) setNotice(skipped ? "این نوبت رد شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (error as Error).message || "رد سررسید ناموفق بود؛ دوباره تلاش کنید");
    } finally {
      writing.current = false;
      if (current()) setBusy(null);
    }
  }

  async function openOccurrence(item: DueItem) {
    if (writing.current || form.busy || form.open) return;
    writing.current = true; setBusy(item.tx.id + item.dueDate); setNotice(null);
    try { await form.openForOccurrence(item.tx, item.dueDate); }
    finally { writing.current = false; if (mounted.current) setBusy(null); }
  }

  return (
    <section className="strip due-rec">
      <div className="strip-head">
        <h3 className="strip-title">سررسید تراکنش‌های تکرارشونده</h3>
        <span className="strip-hint">{toFa(items.length)} مورد</span>
      </div>
      {notice !== null ? <p className="field-error recurring-notice" role="status">{notice}</p> : null}

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
                  {item.label} · {formatExpressionValue(toDisplay(item.tx.amount, cur))} <CurrencyUnit />
                </p>
              </div>
              <div className="due-actions">
                <button
                  type="button"
                  className="due-yes"
                  disabled={busy !== null || form.busy || form.open}
                  onClick={() => void openOccurrence(item)}
                >
                  {isBusy && form.activity === "checkOccurrence" ? "در حال بررسی…" : "ثبت این نوبت"}
                </button>
                <button
                  type="button"
                  className="due-no"
                  disabled={busy !== null || form.busy || form.open}
                  onClick={() => skip(item)}
                >
                  رد این نوبت
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {items.length > shownCount ? <button type="button" className="btn-secondary recurring-more" disabled={busy !== null || form.busy || form.open}
        onClick={() => setShownCount(count => count + MAX_SHOWN)}>نمایش سررسیدهای بیشتر</button> : null}
    </section>
  );
}
