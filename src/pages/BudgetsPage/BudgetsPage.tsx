/* صفحه بودجه‌بندی — بودجه ماهانه هر دسته هزینه + مصرف ماه جاری
   ───────────────────────────────────────────────────────────
   یک قاعده مهم: مجموع بودجهٔ دسته‌ها نباید از «سقف بودجهٔ ماهانه»‌ای که
   در تنظیمات تعیین شده بیشتر شود. اگر شد، به‌جای رد کردن خشک، همان‌جا
   پیشنهاد می‌دهیم سقف ماهانه را روی مجموع تازهٔ دسته‌ها بگذاریم. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Field, Modal, AmountInput, FitText } from "@/shared/ui";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_ICON,
  type Category,
} from "@/domain/category/category.catalog";
import { budgetStatus, monthCategorySpend } from "@/domain/budget/budget.rules";
import { formatMonth, today } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";

export function BudgetsPage() {
  const {
    useCases,
    family,
    cur: currency,
    member,
    txs,
    budgets,
    customCategories,
    refreshData,
  } = useApp();
  const { show } = useToast();
  const isOwner = member?.role === "owner";

  const [jy, jm] = today();
  const [editing, setEditing] = useState<Category | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  /* مجموعی که با مبلغ تازه به‌دست می‌آید و از سقف ماهانه رد شده — تا وقتی
     پر است، به‌جای ذخیره، پیشنهاد بالا بردن سقف نشان داده می‌شود */
  const [overflow, setOverflow] = useState<number | null>(null);

  const monthLabel = `${formatMonth(jy, jm)}`;
  /* سقف ماهانهٔ خانواده (پایه: تومان). صفر یعنی هنوز تعیین نشده */
  const monthlyCap = family?.budget ?? 0;

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

  /* از سقف رد شده‌ایم؟ (مثلاً سقف را در تنظیمات پایین آورده‌اند) */
  const overCap = monthlyCap > 0 && totals.budgetSum > monthlyCap;

  function openEdit(cat: Category) {
    if (!isOwner) return;
    const b = budgetMap.get(cat.id);
    setAmountStr(b ? formatAmount(toDisplay(b.amount, currency)) : "");
    setOverflow(null);
    setEditing(cat);
  }

  function closeEdit() {
    setEditing(null);
    setOverflow(null);
  }

  /** ذخیره واقعی بودجهٔ دسته — بعد از عبور از بررسی سقف */
  async function persist(amount: number) {
    if (!editing) return;
    setBusy(true);
    try {
      await useCases!.setCategoryBudget.execute({
        category: editing.id,
        amount,
      });
      show("بودجه ذخیره شد");
      closeEdit();
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ذخیره");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!editing) return;
    const amount = fromDisplay(parseAmountInput(amountStr), currency);
    if (!amount || amount <= 0) {
      show("مبلغ بودجه را وارد کنید");
      return;
    }

    /* مجموع تازه = مجموع فعلی، منهای بودجهٔ قبلی همین دسته، به‌علاوهٔ مبلغ تازه */
    const previous = budgetMap.get(editing.id)?.amount ?? 0;
    const projected = totals.budgetSum - previous + amount;
    if (monthlyCap > 0 && projected > monthlyCap) {
      setOverflow(projected);
      return;
    }

    setOverflow(null);
    await persist(amount);
  }

  /** «سقف را زیاد کن» داخل مودال — سقف ماهانه دقیقاً برابر مجموع تازه
      می‌شود و بعد بودجهٔ دسته ذخیره می‌شود */
  async function raiseCapAndSave() {
    if (!editing || overflow === null) return;
    const amount = fromDisplay(parseAmountInput(amountStr), currency);
    setBusy(true);
    try {
      await useCases!.setMonthlyBudget.execute(overflow);
    } catch (e) {
      show((e as Error).message || "خطا در تغییر سقف ماهانه");
      setBusy(false);
      return;
    }
    setBusy(false);
    await persist(amount);
  }

  /** «سقف را زیاد کن» از کارت خلاصه — وقتی از قبل رد شده‌ایم */
  async function syncCapToSum() {
    setBusy(true);
    try {
      await useCases!.setMonthlyBudget.execute(totals.budgetSum);
      show("سقف بودجه ماهانه با مجموع دسته‌ها هماهنگ شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در تغییر سقف ماهانه");
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
      closeEdit();
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
          <p>دسته بندی ماهیانه بودجه</p>
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
                  <FitText>
                    {totals.budgetSum
                      ? formatAmount(toDisplay(totals.budgetSum, currency))
                      : "—"}
                    {totals.budgetSum ? (
                      <span className="cur-tag">{currency}</span>
                    ) : null}
                  </FitText>
                </b>
              </div>
              <div>
                <span>مصرف این ماه</span>
                <b className="expense">
                  <FitText>
                    {formatAmount(toDisplay(totals.spentSum, currency))}
                    <span className="cur-tag">{currency}</span>
                  </FitText>
                </b>
              </div>
              <div>
                <span>
                  {totals.remaining >= 0 ? "باقی‌مانده" : "مصرف بیش از بودجه"}
                </span>
                <b className={totals.remaining >= 0 ? "income" : "expense"}>
                  <FitText>
                    {formatAmount(
                      toDisplay(Math.abs(totals.remaining), currency),
                    )}
                    <span className="cur-tag">{currency}</span>
                  </FitText>
                </b>
              </div>
            </div>
            <p className="budget-reset-hint">
              مصرف هر دسته فقط در همان ماه تقویمی حساب می‌شود
            </p>
          </div>
        </Card>

        {/* رابطه با سقف ماهانهٔ تنظیمات */}
        {monthlyCap > 0 ? (
          overCap ? (
            <div className="budget-cap over">
              <p>
                مجموع بودجه‌بندی دسته‌ها (
                {formatAmount(toDisplay(totals.budgetSum, currency))} {currency}
                ) از سقف بودجه ماهانه‌تان (
                {formatAmount(toDisplay(monthlyCap, currency))} {currency})
                بیشتر شده است.
              </p>
              {isOwner ? (
                <button
                  type="button"
                  className="btn-primary btn-block"
                  disabled={busy}
                  onClick={() => void syncCapToSum()}
                >
                  سقف ماهانه را برابر مجموع دسته‌ها کن
                </button>
              ) : (
                <p className="budget-perm">
                  تغییر سقف ماهانه فقط توسط مدیر خانواده انجام میشود
                </p>
              )}
            </div>
          ) : (
            <p className="budget-cap">
              بودجه ماهانه: {formatAmount(toDisplay(monthlyCap, currency))}{" "}
              {currency} —{" "}
              {formatAmount(toDisplay(monthlyCap - totals.budgetSum, currency))}{" "}
              {currency} از آن هنوز دسته بندی نشده است.
            </p>
          )
        ) : (
          <p className="budget-cap">
            هنوز سقف بودجه ماهانه‌ای تعیین نکرده‌اید — از تنظیمات، «بودجه
            ماهانه» را مشخص کنید تا مجموع دسته‌ها با آن سنجیده شود.
          </p>
        )}

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
                      <FitText>
                        {formatAmount(toDisplay(spent, currency))}
                        <span className="cur-tag">{currency}</span>
                      </FitText>
                    </span>
                    {b ? (
                      <span className="cap">
                        <FitText>
                          از {formatAmount(toDisplay(b.amount, currency))}
                          <span className="cur-tag">{currency}</span>
                        </FitText>
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
                      <span className={remaining >= 0 ? "income" : "expense"}>
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
        onClose={closeEdit}
        title={`بودجه ${editing?.name ?? ""}`}
      >
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <Field label="مبلغ بودجه ماهانه">
              <AmountInput
                value={amountStr}
                onChange={(v) => {
                  setAmountStr(v);
                  /* مبلغ عوض شد یعنی هشدار قبلی دیگر معتبر نیست */
                  setOverflow(null);
                }}
                currency={currency}
              />
            </Field>
            <p className="modal-sub">
              این بودجه برای هر ماه تقویمی تکرار می‌شود و مصرف هر ماه جداگانه از
              صفر محاسبه می‌گردد
            </p>
          </div>
        </div>

        {/* رد شدن از سقف ماهانه — پیشنهاد بالا بردن سقف به‌جای رد کردن */}
        {overflow !== null ? (
          <div className="budget-cap over" style={{ marginTop: 10 }}>
            <p>
              با این مبلغ، مجموع بودجه‌بندی دسته‌ها به{" "}
              {formatAmount(toDisplay(overflow, currency))} {currency} می‌رسد و
              از سقف بودجه ماهانه‌تان (
              {formatAmount(toDisplay(monthlyCap, currency))} {currency}) بیشتر
              می‌شود. اگر می‌خواهید، سقف را روی همین مجموع می‌گذاریم.
            </p>
            <button
              type="button"
              className="btn-primary btn-block"
              disabled={busy}
              onClick={() => void raiseCapAndSave()}
            >
              سقف ماهانه را زیاد کن و ذخیره کن
            </button>
          </div>
        ) : null}

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
          <button className="btn-secondary" onClick={closeEdit}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            ذخیره
          </button>
        </div>
      </Modal>
    </section>
  );
}
