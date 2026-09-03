/* صفحه بودجه‌بندی — بودجه ماهانه هر دسته هزینه + مصرف ماه جاری */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal } from "@/shared/ui";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_ICON,
  type Category,
} from "@/domain/category/category.catalog";
import { budgetStatus, monthCategorySpend } from "@/domain/budget/budget.rules";
import { formatMonth, today } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import {
  formatAmount,
  liveFormatAmount,
  parseAmountInput,
} from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";

export function BudgetsPage() {
  const {
    useCases,
    family,
    member,
    txs,
    budgets,
    customCategories,
    refreshData,
  } = useApp();
  const { show } = useToast();
  const currency = family?.currency ?? "تومان";
  const isOwner = member?.role === "owner";

  const [jy, jm] = today();
  const [editing, setEditing] = useState<Category | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);

  const monthLabel = `${formatMonth(jy, jm)} ${toFa(jy)}`;

  /** دسته‌های هزینه: ثابت + سفارشی */
  const expenseCats = useMemo(() => {
    const customs: Category[] = customCategories
      .filter((c) => c.type === "expense")
      .map((c) => ({
        id: c.id,
        name: c.name,
        icon: CUSTOM_CATEGORY_ICON,
        type: "expense" as const,
      }));
    return [...CATEGORIES.filter((c) => c.type === "expense"), ...customs];
  }, [customCategories]);

  /** مصرف ماه جاری هر دسته — با عوض‌شدن ماه از صفر شروع می‌شود */
  const spend = useMemo(() => monthCategorySpend(txs, jy, jm), [txs, jy, jm]);
  const budgetMap = useMemo(
    () => new Map(budgets.map((b) => [b.category, b])),
    [budgets],
  );

  const totals = useMemo(() => {
    let budgetSum = 0;
    let spentSum = 0;
    for (const b of budgets) budgetSum += b.amount;
    for (const v of spend.values()) spentSum += v;
    return { budgetSum, spentSum, remaining: budgetSum - spentSum };
  }, [budgets, spend]);

  function openEdit(cat: Category) {
    if (!isOwner) return;
    const b = budgetMap.get(cat.id);
    setAmountStr(
      b ? formatAmount(toDisplay(b.amount, currency)) : "",
    );
    setEditing(cat);
  }

  async function save() {
    if (!editing) return;
    const amount = fromDisplay(parseAmountInput(amountStr), currency);
    if (!amount || amount <= 0) {
      show("مبلغ بودجه را وارد کنید");
      return;
    }
    setBusy(true);
    try {
      await useCases!.setCategoryBudget.execute({
        category: editing.id,
        amount,
      });
      show("بودجه ذخیره شد");
      setEditing(null);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setBusy(false);
    }
  }

  async function removeBudget() {
    if (!editing) return;
    setBusy(true);
    try {
      await useCases!.deleteCategoryBudget.execute(editing.id);
      show("بودجه حذف شد");
      setEditing(null);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>بودجه‌بندی</h1>
          <p>بودجه ماهانه دسته‌های هزینه</p>
        </div>
      </header>

      <div className="content">
        {/* خلاصه ماه جاری */}
        <Card>
          <div className="budget-summary">
            <p className="budget-month">{monthLabel}</p>
            <div className="budget-summary-nums">
              <div>
                <span>مجموع بودجه</span>
                <b>
                  {totals.budgetSum
                    ? formatAmount(toDisplay(totals.budgetSum, currency))
                    : "—"}
                </b>
              </div>
              <div>
                <span>مصرف این ماه</span>
                <b className="expense">
                  {formatAmount(toDisplay(totals.spentSum, currency))}
                </b>
              </div>
              <div>
                <span>{totals.remaining >= 0 ? "باقی‌مانده" : "فاتور"}</span>
                <b className={totals.remaining >= 0 ? "income" : "expense"}>
                  {formatAmount(toDisplay(Math.abs(totals.remaining), currency))}
                </b>
              </div>
            </div>
            <p className="budget-reset-hint">
              مصرف هر دسته فقط در همان ماه تقویمی حساب می‌شود — با شروع ماه
              جدید از صفر شروع می‌شود
            </p>
          </div>
        </Card>

        <Card title="دسته‌های هزینه">
          {expenseCats.map((cat) => {
            const b = budgetMap.get(cat.id);
            const spent = spend.get(cat.id) ?? 0;
            const st = budgetStatus(b?.amount ?? 0, spent);
            const remaining = (b?.amount ?? 0) - spent;

            return (
              <button
                key={cat.id}
                type="button"
                className="budget-row"
                onClick={() => openEdit(cat)}
                disabled={!isOwner}
              >
                <div className="budget-row-head">
                  <span className="budget-cat">
                    <svg>
                      <use href={`#${cat.icon}`} />
                    </svg>
                    <b>{cat.name}</b>
                  </span>
                  <span className="budget-nums">
                    <span className="spent">
                      {formatAmount(toDisplay(spent, currency))}
                    </span>
                    {b ? (
                      <span className="cap">
                        از {formatAmount(toDisplay(b.amount, currency))}
                      </span>
                    ) : (
                      <span className="cap none">بدون بودجه</span>
                    )}
                  </span>
                </div>

                {b ? (
                  <>
                    <div className="budget-bar">
                      <span
                        className={`fill ${st.level}`}
                        style={{ width: `${Math.min(st.percent, 100)}%` }}
                      />
                    </div>
                    <div className="budget-row-foot">
                      <span>{toFa(st.percent)}٪ مصرف‌شده</span>
                      <span
                        className={remaining >= 0 ? "income" : "expense"}
                      >
                        {remaining >= 0
                          ? `${formatAmount(toDisplay(remaining, currency))} ${currency} باقی‌مانده`
                          : `${formatAmount(toDisplay(-remaining, currency))} ${currency} بیشتر از بودجه`}
                      </span>
                    </div>
                  </>
                ) : null}
              </button>
            );
          })}

          {!isOwner ? (
            <p className="budget-perm">
              تعریف و تغییر بودجه فقط توسط مدیر خانواده امکان‌پذیر است
            </p>
          ) : null}
        </Card>
      </div>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`بودجه ${editing?.name ?? ""}`}
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <Field label={`مبلغ بودجه ماهانه (${currency})`}>
              <input
                type="text"
                className="num-input"
                inputMode="numeric"
                placeholder="۰"
                value={amountStr}
                onChange={(e) => setAmountStr(liveFormatAmount(e.target.value))}
              />
            </Field>
            <p className="modal-sub">
              این بودجه برای هر ماه تقویمی تکرار می‌شود و مصرف هر ماه جداگانه
              از صفر محاسبه می‌گردد
            </p>
          </div>
        </div>

        <div className="modal-actions">
          {budgetMap.get(editing?.id ?? "") ? (
            <button
              className="btn-secondary danger-text"
              disabled={busy}
              onClick={() => void removeBudget()}
            >
              حذف
            </button>
          ) : null}
          <button className="btn-secondary" onClick={() => setEditing(null)}>
            انصراف
          </button>
          <button className="btn-primary" disabled={busy} onClick={() => void save()}>
            ذخیره
          </button>
        </div>
      </Modal>
    </section>
  );
}
