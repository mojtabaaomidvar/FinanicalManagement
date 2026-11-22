import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* صفحه بودجه‌بندی — بودجه ماهانه هر دسته هزینه + مصرف ماه جاری
   ───────────────────────────────────────────────────────────
   یک قاعده مهم: مجموع بودجهٔ دسته‌ها نباید از «سقف بودجهٔ ماهانه»‌ای که
   در تنظیمات تعیین شده بیشتر شود. اگر شد، به‌جای رد کردن خشک، همان‌جا
   پیشنهاد می‌دهیم سقف ماهانه را روی مجموع تازهٔ دسته‌ها بگذاریم. */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { Card, Modal, FitText, Icon, Select, TextInput, expressionInputCaret, normalizeExpressionInput } from "@/shared/ui";
import {
  CATEGORIES,
  CUSTOM_CATEGORY_ICON,
  categoryById,
  type Category,
} from "@/domain/category/category.catalog";
import { budgetStatus, monthCategorySpend, parseCategoryBudgetAmount, parseMonthlyBudgetAmount, spendCapacity } from "@/domain/budget/budget.rules";
import { daysLeftInMonth, formatMonth, today } from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { isAppError } from "@/shared/lib/appError";
import "./BudgetsPage.css";
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
    budgetDataStatus,
    offlineSession,
    shoppingSync,
    customCategories,
    refreshData,
  } = useApp();
  const { show } = useToast();
  const canManage = member?.role === "owner" || member?.role === "admin";
  const restricted = offlineSession || shoppingSync.offline || (typeof navigator !== "undefined" && navigator.onLine === false);
  const identity = `${family?.id ?? ""}:${member?.id ?? ""}:${member?.role ?? ""}:${currency}:${restricted}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  const mounted = useRef(true);

  const [jy, jm, jd] = today();
  const [editing, setEditing] = useState<Category | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState("");
  const [snapshot, setSnapshot] = useState<{ amount: number; cap: number; total: number } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [capOpen, setCapOpen] = useState(false);
  const [capStr, setCapStr] = useState("");
  const [capSnapshot, setCapSnapshot] = useState<{ budget: number; total: number } | null>(null);
  const [capNotice, setCapNotice] = useState("");
  const amountId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  /* مجموعی که با مبلغ تازه به‌دست می‌آید و از سقف ماهانه رد شده — تا وقتی
     پر است، به‌جای ذخیره، پیشنهاد بالا بردن سقف نشان داده می‌شود */
  const [overflow, setOverflow] = useState<number | null>(null);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    writing.current = false; setBusy(false); setEditing(null); setSnapshot(null);
    setOverflow(null); setNotice(""); setCapOpen(false); setCapNotice(""); setDeleteConfirm(false);
    setAmountStr(""); setCapStr(""); setCapSnapshot(null);
    setQuery(""); setFilter("all");
  }, [identity]);
  useEffect(() => {
    // Reopening this page must include a write that finished after the previous page unmounted.
    if (!restricted && budgetDataStatus === "ready") void refreshData().catch(() => undefined);
  }, [identity, refreshData]);
  function currentRequest() {
    const scope = identityRef.current;
    return () => mounted.current && identityRef.current === scope;
  }

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
    const current = [...CATEGORIES.filter((c) => c.type === "expense"), ...customs];
    const known = new Set(current.map(cat => cat.id));
    const legacy = budgets.filter(item => !known.has(item.category)).map(item => ({
      ...categoryById(item.category), id: item.category,
    }));
    return [...current, ...legacy];
  }, [customCategories, budgets]);

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
  const rows = expenseCats.filter(cat => {
    const budget = budgetMap.get(cat.id)?.amount ?? 0;
    const spent = spend.get(cat.id) ?? 0;
    if (filter === "budgeted" && budget <= 0) return false;
    if (filter === "none" && budget > 0) return false;
    if (filter === "over" && (budget <= 0 || spent <= budget)) return false;
    return cat.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  }).sort((a, b) => Number(budgetMap.has(b.id)) - Number(budgetMap.has(a.id)));

  function openEdit(cat: Category) {
    if (!canManage || writing.current || budgetDataStatus !== "ready") return;
    const b = budgetMap.get(cat.id);
    setAmountStr(b ? formatAmount(toDisplay(b.amount, currency)) : "");
    setOverflow(null);
    setNotice("");
    setDeleteConfirm(false);
    setSnapshot({ amount: b?.amount ?? 0, cap: monthlyCap, total: totals.budgetSum });
    setEditing(cat);
  }

  function resetEdit() {
    setEditing(null);
    setOverflow(null);
    setNotice("");
    setSnapshot(null); setDeleteConfirm(false);
  }

  function closeEdit() {
    if (!writing.current) resetEdit();
  }

  function beginWrite() {
    if (writing.current || !canManage || !useCases || budgetDataStatus !== "ready") return false;
    writing.current = true;
    setBusy(true);
    setNotice("");
    return true;
  }

  function endWrite() {
    writing.current = false;
    setBusy(false);
  }

  async function refreshSnapshot(current: () => boolean) {
    const [nextBudgets, nextFamily] = await Promise.all([useCases!.listCategoryBudgets.execute(), useCases!.getFamily.execute()]);
    if (!current()) return;
    const nextTotal = nextBudgets.reduce((sum, item) => sum + item.amount, 0);
    setSnapshot({ amount: nextBudgets.find(item => item.category === editing?.id)?.amount ?? 0,
      cap: nextFamily.budget ?? 0, total: nextTotal });
    setCapSnapshot({ budget: nextFamily.budget ?? 0, total: nextTotal });
    setOverflow(null); setDeleteConfirm(false);
    await refreshData();
  }

  /** ذخیره واقعی بودجهٔ دسته — بعد از عبور از بررسی سقف */
  async function persist(amount: number, raisedCap?: number) {
    if (!editing || !snapshot || !beginWrite()) return;
    const category = editing.id;
    const current = currentRequest();
    let budgetSaved = false;
    try {
      await useCases!.setCategoryBudget.execute({
        category,
        amount,
        ...(raisedCap === undefined ? {} : { monthlyCap: raisedCap }),
        expectedAmount: snapshot.amount, expectedMonthlyCap: snapshot.cap, expectedBudgetTotal: snapshot.total,
      });
      if (!current()) return;
      budgetSaved = true;
      show("بودجه ذخیره شد");
      resetEdit();
    } catch (e) {
      if (!current()) return;
      if (isAppError(e) && (e.code === "CONFLICT" || e.status === 409)) {
        try { await refreshSnapshot(current); } catch { /* The original failure remains visible. */ }
      }
      if (!current()) return;
      const message = (e as Error).message || "خطا در ذخیرهٔ بودجه";
      setNotice(message);
      show(message);
    } finally {
      if (current() && budgetSaved) {
        try { await refreshData(); }
        catch { if (current()) show("تغییر بودجه ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      if (current()) endWrite();
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
    if (!snapshot) return;
    const projected = snapshot.total - snapshot.amount + amount;
    if (snapshot.cap > 0 && projected > snapshot.cap && projected > snapshot.total) {
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
    const current = currentRequest();
    try {
      await useCases!.setMonthlyBudget.execute(totals.budgetSum, { budget: monthlyCap, total: totals.budgetSum });
      if (!current()) return;
      capSaved = true;
      show("سقف بودجه ماهانه با مجموع دسته‌ها هماهنگ شد");
    } catch (e) {
      if (current()) { await refreshData().catch(() => undefined); if (current()) show((e as Error).message || "خطا در تغییر سقف ماهانه"); }
    } finally {
      if (current() && capSaved) {
        try { await refreshData(); }
        catch { if (current()) show("تغییر بودجه ذخیره شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      if (current()) endWrite();
    }
  }

  async function removeBudget() {
    if (!editing || !snapshot || !deleteConfirm || !beginWrite()) return;
    const current = currentRequest();
    let removed = false;
    try {
      await useCases!.deleteCategoryBudget.execute(editing.id, snapshot.amount);
      if (!current()) return;
      removed = true;
      show("بودجه حذف شد");
      resetEdit();
    } catch (e) {
      if (!current()) return;
      if (isAppError(e) && (e.code === "CONFLICT" || e.status === 409)) {
        try { await refreshSnapshot(current); } catch { /* Keep the proposed amount intact. */ }
      }
      if (!current()) return;
      const message = (e as Error).message || "خطا در حذف بودجه";
      setNotice(message);
      show(message);
    } finally {
      if (current() && removed) {
        try { await refreshData(); }
        catch { if (current()) show("بودجه حذف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید"); }
      }
      if (current()) endWrite();
    }
  }

  function openCap() {
    if (!canManage || writing.current || budgetDataStatus !== "ready") return;
    setCapStr(formatAmount(toDisplay(monthlyCap, currency)));
    setCapSnapshot({ budget: monthlyCap, total: totals.budgetSum });
    setCapNotice(""); setCapOpen(true);
  }

  async function saveCap() {
    const amount = parseMonthlyBudgetAmount(capStr, currency);
    if (amount === null) { setCapNotice("مبلغ سقف ماهانه را معتبر وارد کنید"); return; }
    if (!capSnapshot || !beginWrite()) return;
    const current = currentRequest();
    let saved = false;
    try {
      await useCases!.setMonthlyBudget.execute(amount, capSnapshot);
      if (!current()) return;
      saved = true;
      setCapOpen(false); show("سقف ماهانه ذخیره شد");
      await refreshData();
    } catch (e) {
      if (!current()) return;
      if (saved) { show("سقف ماهانه ذخیره شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید"); return; }
      if (isAppError(e) && (e.code === "CONFLICT" || e.status === 409)) {
        try { await refreshSnapshot(current); } catch { /* Preserve the draft. */ }
      }
      if (current()) setCapNotice((e as Error).message || "خطا در ذخیرهٔ سقف ماهانه");
    } finally { if (current()) endWrite(); }
  }

  return (
    <section className="page active budgets-page">
      <header className="app-header budgets-header">
        <div className="header-title">
          <h1>بودجه‌بندی</h1>
          <p>بودجهٔ ماهانهٔ خانواده</p>
        </div>
        {canManage ? <button type="button" className="btn-primary budget-add-button"
          disabled={busy || budgetDataStatus !== "ready"}
          onClick={() => { const cat = expenseCats.find(item => !budgetMap.has(item.id)) ?? expenseCats[0]; if (cat) openEdit(cat); }}>
          <Icon name="i-plus" /><span>بودجه جدید</span>
        </button> : null}
      </header>

      <div className="content">
        {budgetDataStatus !== "ready" ? <Card>
          {budgetDataStatus === "loading" ? <p className="budget-data-message" role="status">در حال دریافت بودجه‌ها…</p> : <div className="budget-data-message" role="alert">
            <p>اطلاعات بودجه‌ها دریافت نشد؛ مقادیر خالی به معنی نبود بودجه نیست.</p>
            <button type="button" className="btn-secondary" onClick={() => void refreshData().catch(() => undefined)}>تلاش دوباره</button>
          </div>}
        </Card> : <>
        {/* خلاصه ماه جاری */}
        <Card>
          <div className="budget-summary">
            <div className="budget-summary-head"><p className="budget-month">{monthLabel}</p>
              {canManage ? <button type="button" className="link-btn budget-cap-edit" disabled={busy} onClick={openCap}>تنظیم سقف</button> : null}
            </div>
            <div className="budget-monthly-cap"><span>سقف ماهانهٔ خانواده</span>
              <b dir="ltr">{monthlyCap > 0 ? formatAmount(toDisplay(monthlyCap, currency)) : "—"}</b>
              {monthlyCap > 0 ? <span>{currencyDisplayLabel(currency)}</span> : null}
            </div>
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
            سقف ماهانهٔ خانواده هنوز تعیین نشده است؛ تعیین سقف، بودجهٔ دسته‌ها را خودکار تغییر نمی‌دهد.
          </p>
        )}

        <div className="budget-list-toolbar">
          <TextInput value={query} onChange={setQuery} placeholder="جست‌وجوی دسته…" aria-label="جست‌وجوی دستهٔ بودجه" />
          <Select value={filter} onChange={setFilter} aria-label="فیلتر بودجه‌ها" options={[
            { value: "all", label: "همهٔ دسته‌ها" },
            { value: "budgeted", label: "بودجه‌دار" },
            { value: "none", label: "بدون بودجه" },
            { value: "over", label: "بیش از بودجه" },
          ]} />
        </div>
        <Card title="دسته‌های هزینه">
          {rows.length === 0 ? <p className="budget-empty" role="status">دسته‌ای با این جست‌وجو و فیلتر پیدا نشد.</p> : null}
          {rows.map((cat) => {
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
        </>}
      </div>

      <Modal
        open={!!editing}
        onClose={closeEdit}
        title={`بودجه ${editing?.name ?? ""}`}
        sheetClassName="budget-editor-sheet"
      >
        <fieldset className="budget-fields" disabled={busy}>
        <div className="form-grid" style={{ marginTop: 8 }}>
          <div className="form-row full"><label>دستهٔ هزینه</label>
            <Select value={editing?.id ?? ""} onChange={id => { const cat = expenseCats.find(item => item.id === id); if (cat) openEdit(cat); }}
              aria-label="دستهٔ بودجه" options={expenseCats.map(cat => ({ value: cat.id, label: cat.name }))} />
          </div>
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
        {snapshot && snapshot.amount > 0 ? <p className="budget-stored-amount">بودجهٔ ثبت‌شده: {formatAmount(toDisplay(snapshot.amount, currency))} {currencyDisplayLabel(currency)}</p> : null}
        {notice ? <p className="budget-save-notice" role="alert">{notice}</p> : null}

        {/* رد شدن از سقف ماهانه — پیشنهاد بالا بردن سقف به‌جای رد کردن */}
        {overflow !== null ? (
          <div className="budget-cap over" style={{ marginTop: 10 }}>
            <p>
              با این مبلغ، مجموع بودجه‌بندی دسته‌ها به{" "}
              {formatAmount(toDisplay(overflow, currency))} {currencyDisplayLabel(currency)} می‌رسد و
              از سقف بودجه ماهانه‌تان (
              {formatAmount(toDisplay(snapshot?.cap ?? monthlyCap, currency))} {currencyDisplayLabel(currency)}) بیشتر
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

        {deleteConfirm ? <div className="budget-delete-confirm" role="alert">
          <p>این بودجه حذف شود؟ هزینه‌های ثبت‌شده حفظ می‌شوند و در بخش هزینه‌های بدون بودجه نمایش داده می‌شوند.</p>
          <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setDeleteConfirm(false)}>بازگشت به ویرایش</button>
            <button type="button" className="btn-primary danger" onClick={() => void removeBudget()}>تأیید حذف بودجه</button></div>
        </div> : null}

        <div className="modal-actions">
          {budgetMap.get(editing?.id ?? "") ? (
            <button
              className="btn-secondary danger-text"
              disabled={busy}
              onClick={() => setDeleteConfirm(true)}
            >
              حذف
            </button>
          ) : null}
          <button className="btn-secondary" disabled={busy} onClick={closeEdit}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy || deleteConfirm || budgetDataStatus !== "ready"}
            onClick={() => void save()}
          >
            {busy ? "در حال ذخیره…" : "ذخیره"}
          </button>
        </div>
        </fieldset>
      </Modal>
      <Modal open={capOpen} onClose={() => { if (!writing.current) setCapOpen(false); }} title="سقف بودجهٔ ماهانه" sheetClassName="budget-cap-sheet">
        <fieldset className="budget-fields" disabled={busy}>
          <div className="form-row"><label>سقف ماهانهٔ خانواده</label>
            <div className="amt-field"><TextInput value={capStr} onChange={value => { setCapStr(normalizeExpressionInput(value)); setCapNotice(""); }}
              dir="ltr" inputMode="numeric" aria-label="سقف بودجهٔ ماهانه" /><span className="cur-suffix">{currencyDisplayLabel(currency)}</span></div>
          </div>
          <p className="modal-sub">این سقف برای هر ماه شمسی تکرار می‌شود. صفر یعنی سقف ماهانه تعیین نشده است.</p>
          <p className="budget-stored-amount">مجموع بودجهٔ دسته‌ها: {formatAmount(toDisplay(capSnapshot?.total ?? totals.budgetSum, currency))} {currencyDisplayLabel(currency)}</p>
          {capNotice ? <p className="budget-save-notice" role="alert">{capNotice}</p> : null}
          <div className="modal-actions"><button type="button" className="btn-secondary" onClick={() => setCapOpen(false)}>انصراف</button>
            <button type="button" className="btn-primary" disabled={budgetDataStatus !== "ready"} onClick={() => void saveCap()}>{busy ? "در حال ذخیره…" : "ذخیره سقف"}</button></div>
        </fieldset>
      </Modal>
    </section>
  );
}
