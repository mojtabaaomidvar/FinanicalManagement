import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* صفحه بودجه‌بندی — بودجه ماهانه هر دسته هزینه + مصرف ماه جاری
   ───────────────────────────────────────────────────────────
   یک قاعده مهم: مجموع بودجهٔ دسته‌ها نباید از «سقف بودجهٔ ماهانه»‌ای که
   در تنظیمات تعیین شده بیشتر شود. اگر شد، به‌جای رد کردن خشک، همان‌جا
   پیشنهاد می‌دهیم سقف ماهانه را روی مجموع تازهٔ دسته‌ها بگذاریم. */

import { useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Modal, FitText, expressionInputCaret, normalizeExpressionInput } from "@/shared/ui";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_ICON,
  type Category,
} from "@/domain/category/category.catalog";
import { budgetStatus, monthCategorySpend, parseCategoryBudgetAmount, spendCapacity } from "@/domain/budget/budget.rules";
import { daysLeftInMonth, formatMonth, today } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

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
  const canManage = member?.role === "owner" || member?.role === "admin";

  const [jy, jm, jd] = today();
  const [editing, setEditing] = useState<Category | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState("");
  const amountId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  /* مجموعی که با مبلغ تازه به‌دست می‌آید و از سقف ماهانه رد شده — تا وقتی
     پر است، به‌جای ذخیره، پیشنهاد بالا بردن سقف نشان داده می‌شود */
  const [overflow, setOverflow] = useState<number | null>(null);

  useLayoutEffect(() => {
    const next = selection.current;
    selection.current = null;
    if (next && document.activeElement === amountRef.current) amountRef.current?.setSelectionRange(next.start, next.end);
  });

  function changeAmount(raw: string, start: number, end = start) {
    const formatted = normalizeExpressionInput(raw);
    selection.current = { start: expressionInputCaret(raw, formatted, start), end: expressionInputCaret(raw, formatted, end) };
    setAmountStr(formatted);
    setOverflow(null);
    setNotice("");
  }

  function amountChanged(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    changeAmount(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length);
  }

  function amountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const input = event.currentTarget, start = input.selectionStart;
    if (start === null || start !== input.selectionEnd) return;
    if (event.key === "Backspace" && input.value[start - 1] === ",") {
      event.preventDefault();
      changeAmount(input.value.slice(0, start - 2) + input.value.slice(start), start - 2);
    } else if (event.key === "Delete" && input.value[start] === ",") {
      event.preventDefault();
      changeAmount(input.value.slice(0, start) + input.value.slice(start + 2), start);
    }
  }

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
    const capacity = spendCapacity(budgets, spend, daysLeftInMonth([jy, jm, jd]));
    return { budgetSum: capacity.cap, spentSum: capacity.spent, remaining: capacity.remaining,
      active: capacity.active, unbudgetedSpent: capacity.unbudgetedSpent };
  }, [budgets, spend, jy, jm, jd]);

  /* از سقف رد شده‌ایم؟ (مثلاً سقف را در تنظیمات پایین آورده‌اند) */
  const overCap = monthlyCap > 0 && totals.budgetSum > monthlyCap;

  function openEdit(cat: Category) {
    if (!canManage || writing.current) return;
    const b = budgetMap.get(cat.id);
    setAmountStr(b ? formatAmount(toDisplay(b.amount, currency)) : "");
    setOverflow(null);
    setNotice("");
    setEditing(cat);
  }

  function resetEdit() {
    setEditing(null);
    setOverflow(null);
    setNotice("");
  }

  function closeEdit() {
    if (!writing.current) resetEdit();
  }

  function beginWrite() {
    if (writing.current || !canManage || !useCases) return false;
    writing.current = true;
    setBusy(true);
    setNotice("");
    return true;
  }

  function endWrite() {
    writing.current = false;
    setBusy(false);
  }

  /** ذخیره واقعی بودجهٔ دسته — بعد از عبور از بررسی سقف */
  async function persist(amount: number, raisedCap?: number) {
    if (!editing || !beginWrite()) return;
    const category = editing.id;
    let capSaved = false, budgetSaved = false;
    try {
      if (raisedCap !== undefined) {
        await useCases!.setMonthlyBudget.execute(raisedCap);
        capSaved = true;
      }
      await useCases!.setCategoryBudget.execute({
        category,
        amount,
      });
      budgetSaved = true;
      show("بودجه ذخیره شد");
      resetEdit();
    } catch (e) {
      if (capSaved) setOverflow(null);
      const message = capSaved
        ? "سقف ماهانه تغییر کرد، اما بودجهٔ دسته ذخیره نشد؛ دوباره تلاش کنید"
        : (e as Error).message || "خطا در ذخیرهٔ بودجه";
      setNotice(message);
      show(message);
    } finally {
      if (capSaved || budgetSaved) {
        try { await refreshData(); }
        catch { show("تغییر بودجه ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      endWrite();
    }
  }

  async function save() {
    if (!editing || writing.current || !canManage) return;
    const amount = parseCategoryBudgetAmount(amountStr, currency);
    if (amount === null) {
      const message = "مبلغ بودجه را کامل و در محدودهٔ مجاز وارد کنید";
      setNotice(message);
      show(message);
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
    if (!editing || overflow === null || writing.current) return;
    const amount = parseCategoryBudgetAmount(amountStr, currency);
    if (amount === null) return;
    await persist(amount, overflow);
  }

  /** «سقف را زیاد کن» از کارت خلاصه — وقتی از قبل رد شده‌ایم */
  async function syncCapToSum() {
    if (!beginWrite()) return;
    let capSaved = false;
    try {
      await useCases!.setMonthlyBudget.execute(totals.budgetSum);
      capSaved = true;
      show("سقف بودجه ماهانه با مجموع دسته‌ها هماهنگ شد");
    } catch (e) {
      show((e as Error).message || "خطا در تغییر سقف ماهانه");
    } finally {
      if (capSaved) {
        try { await refreshData(); }
        catch { show("تغییر بودجه ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      endWrite();
    }
  }

  async function removeBudget() {
    if (!editing || !beginWrite()) return;
    let removed = false;
    try {
      await useCases!.deleteCategoryBudget.execute(editing.id);
      removed = true;
      show("بودجه حذف شد");
      resetEdit();
    } catch (e) {
      const message = (e as Error).message || "خطا در حذف بودجه";
      setNotice(message);
      show(message);
    } finally {
      if (removed) {
        try { await refreshData(); }
        catch { show("بودجه حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      endWrite();
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
                <span>بودجهٔ دسته‌ها</span>
                <b>
                  <FitText>
                    {totals.budgetSum
                      ? formatAmount(toDisplay(totals.budgetSum, currency))
                      : "—"}
                    {totals.budgetSum ? (
                      <span className="cur-tag">{currencyDisplayLabel(currency)}</span>
                    ) : null}
                  </FitText>
                </b>
              </div>
              <div>
                <span>مصرف بودجه‌ها</span>
                <b className="expense">
                  <FitText>
                    {formatAmount(toDisplay(totals.spentSum, currency))}
                    <span className="cur-tag">{currencyDisplayLabel(currency)}</span>
                  </FitText>
                </b>
              </div>
              <div>
                <span>
                  {totals.remaining >= 0 ? "باقی‌مانده" : "مصرف بیش از بودجه"}
                </span>
                <b className={!totals.active ? undefined : totals.remaining >= 0 ? "income" : "expense"}>
                  <FitText>
                    {totals.active ? formatAmount(
                      toDisplay(Math.abs(totals.remaining), currency),
                    ) : "—"}
                    {totals.active ? <span className="cur-tag">{currencyDisplayLabel(currency)}</span> : null}
                  </FitText>
                </b>
              </div>
            </div>
            {totals.unbudgetedSpent > 0 ? <p className="budget-unbudgeted">
              هزینهٔ بدون بودجه: {formatAmount(toDisplay(totals.unbudgetedSpent, currency))} {currencyDisplayLabel(currency)}
            </p> : null}
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
                {formatAmount(toDisplay(totals.budgetSum, currency))} {currencyDisplayLabel(currency)}
                ) از سقف بودجه ماهانه‌تان (
                {formatAmount(toDisplay(monthlyCap, currency))} {currencyDisplayLabel(currency)})
                بیشتر شده است.
              </p>
              {canManage ? (
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
              {currencyDisplayLabel(currency)} —{" "}
              {formatAmount(toDisplay(monthlyCap - totals.budgetSum, currency))}{" "}
              {currencyDisplayLabel(currency)} از آن هنوز دسته بندی نشده است.
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
                disabled={!canManage || busy}
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
                        <span className="cur-tag">{currencyDisplayLabel(currency)}</span>
                      </FitText>
                    </span>
                    {b ? (
                      <span className="cap">
                        <FitText>
                          از {formatAmount(toDisplay(b.amount, currency))}
                          <span className="cur-tag">{currencyDisplayLabel(currency)}</span>
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
                          ? `${formatAmount(toDisplay(remaining, currency))} ${currencyDisplayLabel(currency)} باقی‌مانده`
                          : `${formatAmount(toDisplay(-remaining, currency))} ${currencyDisplayLabel(currency)} بیشتر از بودجه`}
                      </span>
                    </div>
                  </>
                ) : null}
              </button>
            );
          })}

          {!canManage ? (
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
        <fieldset className="budget-fields" disabled={busy}>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full">
            <div className="form-row">
              <label htmlFor={amountId}>مبلغ بودجه ماهانه</label>
              <div className="amt-field">
              <input
                ref={amountRef} id={amountId} type="text" inputMode="numeric" dir="ltr"
                className="num-input" autoComplete="off" placeholder="۰"
                value={amountStr}
                onChange={amountChanged} onKeyDown={amountKeyDown}
              />
              <span className="cur-suffix">{currencyDisplayLabel(currency)}</span>
              </div>
            </div>
            <p className="modal-sub">
              این بودجه برای هر ماه تقویمی تکرار می‌شود و مصرف هر ماه جداگانه از
              صفر محاسبه می‌گردد
            </p>
          </div>
        </div>
        {notice ? <p className="budget-save-notice" role="alert">{notice}</p> : null}

        {/* رد شدن از سقف ماهانه — پیشنهاد بالا بردن سقف به‌جای رد کردن */}
        {overflow !== null ? (
          <div className="budget-cap over" style={{ marginTop: 10 }}>
            <p>
              با این مبلغ، مجموع بودجه‌بندی دسته‌ها به{" "}
              {formatAmount(toDisplay(overflow, currency))} {currencyDisplayLabel(currency)} می‌رسد و
              از سقف بودجه ماهانه‌تان (
              {formatAmount(toDisplay(monthlyCap, currency))} {currencyDisplayLabel(currency)}) بیشتر
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
          <button className="btn-secondary" disabled={busy} onClick={closeEdit}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "در حال ذخیره…" : "ذخیره"}
          </button>
        </div>
        </fieldset>
      </Modal>
    </section>
  );
}
