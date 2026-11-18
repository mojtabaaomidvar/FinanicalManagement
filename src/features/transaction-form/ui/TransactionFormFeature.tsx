import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* شیت ثبت/ویرایش تراکنش — بازطراحی v9 «دو گام روشن»

   گام ۱ (هنوز دسته‌ای انتخاب نشده): فقط تب نوع + گرید دسته‌ها + «ثبت از پیامک».
   هیچ چیز دیگری نشان داده نمی‌شود تا صفحه شلوغ نشود؛ مبلغ فقط اگر از قبل
   عددی خورده باشد، به‌صورت یک پیل کوچک یادآوری می‌شود.

   گام ۲ (دسته انتخاب شد یا نوع = انتقال): نوار دسته (تپ = بازگشت به گرید)
   + باکس مبلغ با قاب مشخص + چیپ حساب/تاریخ/تکرار + کارت توضیح و تگ‌ها
   + کیپد ماشین‌حساب و اسکن رسید.

   دایره ۱۱۶پیکسلی نسخه قبل حذف شد (با تب‌ها هم‌معنا بود و ارتفاع می‌خورد)
   و جای آن نوار افقی دسته نشست. */

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { TxFormModel } from "../model/useTxFormModel";
import { SmsImportFeature } from "@/features/sms-import";
import {
  CalcKeypad,
  evaluateExpression,
  expressionInputCaret,
  normalizeExpressionInput,
  formatExpressionValue,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import {
  categoriesFor,
  CUSTOM_CATEGORY_ICON,
  type Category,
} from "@/domain/category/category.catalog";
import { categoryColor } from "@/domain/category/category.colors";
import {
  TX_REPEATS,
  type TxRepeat,
} from "@/domain/transaction/transaction.types";
import { maskCardNumber } from "@/domain/account/account.rules";
import { toDisplay } from "@/shared/lib/currency";

function accountLabel(
  title: string,
  bank: string | null,
  cardNumber: string | null,
): string {
  const parts = [title];
  if (bank) parts.push(bank);
  if (cardNumber) parts.push(maskCardNumber(cardNumber));
  return parts.join(" · ");
}

/* تگ‌های پیشنهادی لیبل — پیش‌فرض عمومی؛ سابقه خانواده هنگام اجرا اضافه می‌شود */
const QUICK_LABELS: Record<"expense" | "income", { value: string; label: string }[]> = {
  expense: [
    { value: "خرید روزانه", label: "خرید روزانه" },
    { value: "نان", label: "نان" },
    { value: "میوه", label: "میوه" },
    { value: "تاکسی", label: "تاکسی" },
    { value: "بنزین", label: "بنزین" },
    { value: "قبض", label: "قبض" },
    { value: "دارو", label: "دارو" },
  ],
  income: [
    { value: "حقوق", label: "حقوق" },
    { value: "پاداش", label: "پاداش" },
    { value: "عیدی", label: "عیدی" },
    { value: "فروش", label: "فروش" },
    { value: "سود سرمایه", label: "سود سرمایه" },
    { value: "هدیه", label: "هدیه" },
  ],
};

const TYPE_TABS: { value: "expense" | "income" | "transfer"; label: string }[] =
  [
    { value: "expense", label: "هزینه" },
    { value: "income", label: "درآمد" },
    { value: "transfer", label: "انتقال" },
  ];

/* مثال توضیح بسته به نوع تراکنش فرق می‌کند — مثال هزینه با درآمد یکی نیست */
const NOTE_PLACEHOLDERS: Record<string, string> = {
  expense: "مثلاً: خرید نان و شیر (اختیاری)…",
  income: "مثلاً: حقوق شهریور (اختیاری)…",
  transfer: "توضیح انتقال (اختیاری)…",
};

/** رنگ تم شیت — رنگ دسته؛ خنثی قبل از انتخاب؛ منت برای انتقال */
function sheetBaseColor(type: string, categoryId: string): string {
  if (type === "transfer") return categoryColor("transfer");
  return categoryId ? categoryColor(categoryId) : "#D1D5DB";
}

export function TransactionFormFeature({
  form,
  onImported,
}: {
  form: TxFormModel;
  /** پس از ثبت موفق پیامک‌ها — تازه‌سازی داده اپ */
  onImported: () => void | Promise<void>;
}) {
  const m = form;
  const {
    accounts,
    subcategories,
    customCategories,
    member,
    refreshData,
  } = useApp();

  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [tagInput, setTagInput] = useState(false);
  const [tagText, setTagText] = useState("");
  const photoFileRef = useRef<HTMLInputElement>(null);
  const receiptStatusRef = useRef<HTMLDivElement>(null);
  const balanceWarningRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const amountSelection = useRef<{ start: number; end: number } | null>(null);
  const amountId = useId();
  const amountHintId = amountId + "-hint";
  const amountResultId = amountId + "-result";
  const balanceTitleId = useId();
  const balanceDescriptionId = useId();

  // Retain logical selection when formatting inserts or removes thousands separators.
  useLayoutEffect(() => {
    const selection = amountSelection.current;
    amountSelection.current = null;
    if (selection && amountInputRef.current === document.activeElement) {
      amountInputRef.current?.setSelectionRange(selection.start, selection.end);
    }
  });

  function handleAmountChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    changeAmount(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length);
  }

  function changeAmount(value: string, start: number, end = start) {
    const formatted = normalizeExpressionInput(value);
    amountSelection.current = {
      start: expressionInputCaret(value, formatted, start),
      end: expressionInputCaret(value, formatted, end),
    };
    m.setAmount(value);
  }

  function handleAmountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

  function handleBalanceKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function dismissBalanceWarning() {
    if (m.busy) return;
    m.dismissBalanceWarning();
    requestAnimationFrame(() => amountInputRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (m.receiptError) {
      receiptStatusRef.current?.closest<HTMLElement>(".tx-sheet")?.scrollTo({ top: 0 });
    }
  }, [m.receiptError]);

  useEffect(() => {
    if (!m.balanceWarning) return;
    balanceWarningRef.current?.focus({ preventScroll: true });
  }, [m.balanceWarning]);

  /* شیت بسته شد → حالت‌های موقتی UI پاک شوند، وگرنه دفعه بعد
     فیلد «دسته جدید» یا «لیبل جدید» باز و نیمه‌پرشده باز می‌شود
     (این کامپوننت همیشه mount است و state آن زنده می‌ماند) */
  useEffect(() => {
    if (m.open) return;
    setShowAddCat(false);
    setNewCatName("");
    setTagInput(false);
    setTagText("");
  }, [m.open]);

  const isTransfer = m.form.type === "transfer";
  /* گام ۱ = هنوز دسته‌ای انتخاب نشده (فقط هزینه/درآمد) */
  const showGrid = !isTransfer && !m.form.categoryId;

  /* دسته‌های قابل نمایش: ثابت + سفارشی همین نوع */
  const cats: Category[] = useMemo(
    () =>
      isTransfer
        ? []
        : [
            ...categoriesFor(m.form.type),
            ...customCategories
              .filter((c) => c.type === m.form.type)
              .map((c) => ({
                id: c.id,
                name: c.name,
                icon: CUSTOM_CATEGORY_ICON,
                type: c.type,
              })),
          ],
    [isTransfer, m.form.type, customCategories],
  );

  const activeCat = cats.find((c) => c.id === m.form.categoryId);
  const base = sheetBaseColor(m.form.type, m.form.categoryId);
  /* رنگ اکشن (کیپد/ذخیره/تگ فعال) — خنثی = اکشن برند */
  const catColor = m.form.categoryId || isTransfer ? base : "var(--accent)";

  /* آیکون و نام نوار دسته در گام ۲ */
  const catIcon = isTransfer ? "i-swap" : (activeCat?.icon ?? "i-grid4");
  const catName = isTransfer
    ? "انتقال وجه"
    : (activeCat?.name ?? (m.form.type === "income" ? "درآمد" : "هزینه"));

  /* تگ‌های پیشنهادی = سابقه لیبل‌های خانواده برای این دسته + پیش‌فرض‌ها */
  const tags = useMemo(() => {
    const own = subcategories
      .filter((s) => s.category === m.form.categoryId)
      .map((s) => ({ value: s.name, label: s.name }));
    const baseTags =
      QUICK_LABELS[m.form.type === "income" ? "income" : "expense"];
    const byValue = new Map(own.map(tag => [tag.value, tag]));
    for (const tag of baseTags) byValue.set(tag.value, tag);
    return [...byValue.values()].slice(0, 9);
  }, [subcategories, m.form.categoryId, m.form.type]);

  /* نتیجه زنده عبارت ریاضی «۱۲+۵» زیر مبلغ */
  const exprResult = useMemo(() => {
    if (!/[+\-×÷]/.test(m.form.amount)) return null;
    const r = evaluateExpression(m.form.amount);
    return r === null ? null : formatExpressionValue(r);
  }, [m.form.amount]);

  function pickCategory(catId: string) {
    if (catId !== m.form.categoryId) {
      m.setForm({ ...m.form, categoryId: catId, label: "" });
    }
  }

  /* بازگشت به گرید انتخاب دسته — تپ روی نوار دسته */
  function backToGrid() {
    if (m.serviceExpense) return;
    if (!isTransfer && m.form.categoryId) {
      m.setForm({ ...m.form, categoryId: "", label: "" });
    }
  }

  function applyCustomLabel() {
    const t = tagText.trim();
    if (t) m.setForm({ ...m.form, label: t.slice(0, 30) });
    setTagText("");
    setTagInput(false);
  }

  /* پیامک‌ها خودشان تراکنش ساختند → شیت دستی دیگر لازم نیست */
  async function smsImported() {
    await onImported();
    m.close();
  }

  async function addCategory() {
    if (await m.addCategory(newCatName, refreshData)) {
      setShowAddCat(false);
      setNewCatName("");
    }
  }

  const accountOpts = [
    {
      value: "",
      label: m.serviceExpense ? "بدون حساب مشخص" : accounts.length ? "انتخاب حساب…" : "حسابی ثبت نشده",
    },
    ...accounts.map((a) => ({
      value: a.id,
      label: accountLabel(a.title, a.bank, a.cardNumber),
    })),
  ];

  return (
    <>
    <Modal
      open={m.open}
      onClose={m.close}
      padded={false}
      dragToClose
      sheetClassName="tx-sheet"
    >
      <div
        className="tx-form"
        aria-busy={m.busy}
        style={
          { "--cat-color": catColor, "--sheet-tint": base } as CSSProperties
        }
      >
        {/* ── هدر: بستن / عنوان / حذف + ذخیره ── */}
        <div className="tx-head">
          <button
            type="button"
            className="tx-head-btn tx-close-btn"
            aria-label="بستن"
            disabled={m.busy || !!m.balanceWarning}
            onClick={m.close}
          >
            <svg>
              <use href="#i-x" />
            </svg>
          </button>
          <span className="tx-head-title">
            {m.occurrencePending ? m.occurrenceAcknowledged ? "تکمیل رسیدها" : "تأیید سررسید" : m.editing ? "ویرایش تراکنش" : "تراکنش جدید"}
          </span>
          <span className="tx-head-actions">
            {m.editing && !m.occurrencePending &&
            (member?.role === "owner" || member?.role === "admin" || m.editing.memberId === member?.id) ? (
              <button
                type="button"
                className="tx-head-btn tx-trash-btn"
                aria-label="حذف تراکنش"
                disabled={m.busy}
                onClick={() => m.remove(refreshData)}
              >
                <svg>
                  <use href="#i-trash" />
                </svg>
              </button>
            ) : null}
            <button
              type="button"
              className="tx-head-btn tx-save-btn"
              aria-busy={m.busy}
              disabled={m.busy || !!m.balanceWarning}
              onClick={() => m.save(refreshData, accounts.length)}
            >
              {m.activity !== "save" && m.activity !== "checkBalance" && m.activity !== "checkOccurrence" ? (
                <svg aria-hidden="true">
                  <use href="#i-check" />
                </svg>
              ) : null}
              <span>
                {m.activity === "checkOccurrence" ? "در حال بررسی سررسید…"
                  : m.activity === "checkBalance" ? "در حال بررسی موجودی…"
                  : m.activity === "save" ? "در حال ذخیره…"
                  : m.occurrencePending ? m.occurrenceAcknowledged ? "ذخیرهٔ رسیدها" : "تأیید سررسید"
                    : m.editing ? "ذخیرهٔ تغییرات"
                    : m.form.type === "expense" ? "ثبت هزینه"
                      : m.form.type === "income" ? "ثبت درآمد" : "ثبت انتقال"}
              </span>
            </button>
          </span>
        </div>

        {m.receiptError ? (
          <div ref={receiptStatusRef} className="tx-save-status" role="status">
            <p>تراکنش ذخیره شده است؛ بعضی رسیدها هنوز ذخیره نشده‌اند. با ذخیرهٔ دوباره، همین تراکنش تکمیل می‌شود.</p>
            <p>{m.receiptError}</p>
          </div>
        ) : null}

        {m.occurrencePending && !m.occurrenceAcknowledged ? <div className="tx-save-status tx-occurrence-status" role="status">
          <p>تراکنش این نوبت ثبت شده؛ فقط تأیید سررسید باقی مانده است.</p>
          {m.occurrenceError !== null ? <p>{m.occurrenceError}</p> : null}
        </div> : null}

        <fieldset className="tx-fields" disabled={m.busy || !!m.balanceWarning || m.occurrencePending}>

        {/* ── تب نوع تراکنش ── */}
        <div className="tx-tabs" role="tablist" aria-label="نوع تراکنش">
          {TYPE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              disabled={m.serviceExpense || m.recurringOccurrence}
              aria-selected={m.form.type === t.value}
              className={`tx-tab ${m.form.type === t.value ? "on" : ""}`}
              onClick={() => m.setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {m.serviceExpense ? (
          <p className="tx-chip-hint" style={{ padding: "0 20px" }}>
            هزینهٔ سرویس خودرو؛ مبلغ، حساب و توضیح قابل ویرایش‌اند. تاریخ، دسته و نوع از سرویس ثبت‌شده می‌آیند.
          </p>
        ) : null}

        {showGrid ? (
          /* ═══ گام ۱ — انتخاب دسته ═══ */
          <>
            {/* یادآوری مبلغی که پیش‌تر وارد شده (بازگشت از گام ۲) */}
            {m.form.amount ? (
              <p className="tx-amount-mini">
                مبلغ واردشده
                <b dir="ltr">{m.form.amount}</b>
                <span>{currencyDisplayLabel(m.entryCurrency)}</span>
              </p>
            ) : null}

            <p className="tx-sec-title">
              دسته را انتخاب کنید
              <small>برای ادامه، یکی از دسته‌های زیر را بزنید</small>
            </p>

            <div className="tx-cat-grid">
              {cats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="tx-cat"
                  onClick={() => pickCategory(c.id)}
                >
                  <span
                    className="tx-cat-ico"
                    style={{ color: categoryColor(c.id) }}
                  >
                    <svg>
                      <use href={`#${c.icon}`} />
                    </svg>
                  </span>
                  <span className="tx-cat-name">{c.name}</span>
                </button>
              ))}
              <button
                type="button"
                className="tx-cat"
                onClick={() => setShowAddCat((v) => !v)}
              >
                <span className="tx-cat-ico tx-cat-ico-add">
                  <svg>
                    <use href="#i-plus" />
                  </svg>
                </span>
                <span className="tx-cat-name">دسته جدید</span>
              </button>
            </div>

            {showAddCat ? (
              <form className="tx-add-cat" onSubmit={event => { event.preventDefault(); void addCategory(); }}>
                <TextInput
                  aria-label="نام دستهٔ جدید"
                  value={newCatName}
                  onChange={value => { setNewCatName(value); m.clearCategoryError(); }}
                  placeholder="نام دسته مورد نظر شما"
                  autoFocus
                  maxLength={30}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={m.busy}
                >
                  {m.activity === "saveCategory" ? "در حال ساخت دسته…" : "ثبت"}
                </button>
              </form>
            ) : null}
            {m.categoryError !== null ? <p className="field-error tx-category-error" role="status">{m.categoryError}</p> : null}

            {/* راه دوم ثبت — پیامک بانکی (پیش‌تر روی صفحه خانه بود) */}
            {!m.editing ? (
              <div className="tx-alt">
                <span className="tx-alt-sep">
                  <i />
                  یا
                  <i />
                </span>
                <SmsImportFeature onImported={smsImported} variant="row" />
              </div>
            ) : null}
          </>
        ) : (
          /* ═══ گام ۲ — جزئیات تراکنش ═══ */
          <>
            {/* نوار دسته — تپ = بازگشت به گرید (برای انتقال غیرفعال) */}
            <button
              type="button"
              className="tx-catbar"
              disabled={isTransfer || m.serviceExpense}
              aria-label={isTransfer ? undefined : "تغییر دسته‌بندی"}
              onClick={backToGrid}
            >
              <span
                className="tx-catbar-ico"
                style={{
                  background: `color-mix(in srgb, ${base} 34%, var(--card))`,
                  color: `color-mix(in srgb, ${base} 82%, var(--text))`,
                }}
              >
                <svg>
                  <use href={`#${catIcon}`} />
                </svg>
              </span>
              <span className="tx-catbar-name">{catName}</span>
              {!isTransfer && !m.serviceExpense ? (
                <span className="tx-catbar-change">
                  تغییر دسته
                  <svg>
                    <use href="#i-arrow-r" />
                  </svg>
                </span>
              ) : null}
            </button>

            {/* ردیف حساب‌های انتقال (فقط تب انتقال) */}
            {isTransfer ? (
              <div className="tx-transfer-row">
                <label className="tx-pill">
                  <svg>
                    <use href="#i-card" />
                  </svg>
                  <Select
                    className="tx-pill-select"
                    aria-label="حساب مبدأ"
                    value={m.form.accountId}
                    onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                    options={accountOpts}
                  />
                </label>
                <button
                  type="button"
                  className="tx-swap-btn"
                  aria-label="جابه‌جایی مبدأ و مقصد"
                  title="جابه‌جایی مبدأ و مقصد"
                  onClick={() =>
                    m.setForm({
                      ...m.form,
                      accountId: m.form.toAccountId,
                      toAccountId: m.form.accountId,
                    })
                  }
                >
                  <svg>
                    <use href="#i-swap" />
                  </svg>
                </button>
                <label className="tx-pill">
                  <svg>
                    <use href="#i-wallet" />
                  </svg>
                  <Select
                    className="tx-pill-select"
                    aria-label="حساب مقصد"
                    value={m.form.toAccountId}
                    onChange={(v) => m.setForm({ ...m.form, toAccountId: v })}
                    options={[
                      { value: "", label: "حساب مقصد…" },
                      ...accounts
                        .filter((a) => a.id !== m.form.accountId)
                        .map((a) => ({
                          value: a.id,
                          label: accountLabel(a.title, a.bank, a.cardNumber),
                        })),
                    ]}
                  />
                </label>
              </div>
            ) : null}

            {/* ── باکس مبلغ (قاب مشخص) ── */}
            <div className="tx-amount-box">
              <div className="tx-amount-top">
                <label className="tx-amount-cap" htmlFor={amountId}>
                  {m.form.type === "expense" ? "مبلغ هزینه"
                    : m.form.type === "income" ? "مبلغ درآمد"
                      : m.form.type === "transfer" ? "مبلغ انتقال" : "مبلغ"}
                </label>
                <button
                  type="button"
                  className="tx-currency-btn"
                  onClick={() =>
                    m.switchEntryCurrency(
                      m.entryCurrency === "تومان" ? "ریال" : "تومان",
                    )
                  }
                  title="تغییر واحد ورودی مبلغ"
                  aria-label="تغییر واحد ورودی مبلغ"
                >
                  {currencyDisplayLabel(m.entryCurrency)}
                  <svg style={{ transform: "rotate(90deg)" }}>
                    <use href="#i-arrow-r" />
                  </svg>
                </button>
              </div>
              <input
                ref={amountInputRef}
                id={amountId}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                className="tx-amount"
                dir="ltr"
                placeholder="۰"
                value={m.form.amount}
                aria-describedby={exprResult ? `${amountHintId} ${amountResultId}` : amountHintId}
                onChange={handleAmountChange}
                onKeyDown={handleAmountKeyDown}
              />
              {exprResult ? (
                <div id={amountResultId} className="tx-amount-expr" dir="ltr">
                  = {exprResult}
                </div>
              ) : null}
              <p id={amountHintId} className="tx-amount-hint">تایپ کنید یا از دکمه‌های زیر استفاده کنید</p>
            </div>

            {/* ── چیپ حساب / تاریخ / تکرار ── */}
            <div className="tx-chips">
              {!isTransfer ? (
                <label className="tx-pill" title="حساب تراکنش">
                  <svg>
                    <use href="#i-card" />
                  </svg>
                  <Select
                    className="tx-pill-select"
                    aria-label="حساب تراکنش"
                    value={m.form.accountId}
                    onChange={(v) => m.setForm({ ...m.form, accountId: v })}
                    options={accountOpts}
                  />
                </label>
              ) : null}
              <span className="tx-pill tx-pill-date" title="تاریخ و ساعت">
                <svg>
                  <use href="#i-bill" />
                </svg>
                {m.serviceExpense ? <span>{m.form.date}</span> : <JalaliDateInput
                  aria-label="تاریخ و ساعت تراکنش"
                  value={m.form.date}
                  onChange={m.setDate}
                  time={m.form.time}
                  onTimeChange={m.setTime}
                />}
              </span>
              {m.serviceExpense ? <label className="tx-pill">
                ساعت
                <input type="time" className="tx-pill-select" aria-label="ساعت هزینهٔ سرویس" value={m.form.time}
                  onChange={(event) => m.setTime(event.target.value)} />
              </label> : null}
              <label className="tx-pill" title="تکرار">
                <svg>
                  <use href="#i-repeat" />
                </svg>
                <Select
                  className="tx-pill-select"
                  aria-label="تکرار تراکنش"
                  value={m.form.repeat}
                  disabled={m.serviceExpense || m.recurringOccurrence}
                  onChange={(v) => m.setRepeat(v as TxRepeat)}
                  options={TX_REPEATS.map((r) => ({
                    value: r.value,
                    label: r.label,
                  }))}
                />
              </label>
            </div>

            {m.form.repeat !== "none" ? (
              <div className="tx-chips">
                <span
                  className="tx-pill tx-pill-date"
                  title="تاریخ پایان تکرار (الزامی)"
                >
                  <svg>
                    <use href="#i-clock" />
                  </svg>
                  <JalaliDateInput
                    aria-label="تاریخ پایان تکرار"
                    value={m.form.repeatEnd}
                    onChange={m.setRepeatEnd}
                    placeholder="تاریخ پایان…"
                  />
                </span>
                <span className="tx-chip-hint">
                  {TX_REPEATS.find((r) => r.value === m.form.repeat)?.label} تا{" "}
                  {m.form.repeatEnd || "…"}
                </span>
              </div>
            ) : null}

            {/* ── کارت توضیح: فقط پس از انتخاب دسته دیده می‌شود ── */}
            <div className="tx-desc-card">
              <textarea
                aria-label="توضیح تراکنش"
                className="tx-desc-input"
                rows={2}
                placeholder={
                  NOTE_PLACEHOLDERS[m.form.type] ?? "توضیح تراکنش (اختیاری)…"
                }
                value={m.form.note}
                onChange={(e) => m.setForm({ ...m.form, note: e.target.value })}
              />
              <div className="tx-desc-foot">
                <button
                  type="button"
                  className="tx-cam-btn"
                  aria-label="افزودن تصویر رسید"
                  title="افزودن تصویر رسید"
                  onClick={() => photoFileRef.current?.click()}
                >
                  <svg>
                    <use href="#i-image" />
                  </svg>
                </button>
                {!isTransfer ? (
                  <div className="tx-tags">
                    {/* لیبل فعلی خارج از پیشنهادها → چیپ انتخاب‌شده */}
                    {m.form.label && !tags.some(tag => tag.value === m.form.label) ? (
                      <button
                        type="button"
                        className="tx-tag on"
                        onClick={() => m.setForm({ ...m.form, label: "" })}
                      >
                        <svg>
                          <use href="#i-check" />
                        </svg>
                        {m.form.label}
                      </button>
                    ) : null}
                    {tags.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={`tx-tag ${m.form.label === t.value ? "on" : ""}`}
                        aria-pressed={m.form.label === t.value}
                        onClick={() =>
                          m.setForm({
                            ...m.form,
                            label: m.form.label === t.value ? "" : t.value,
                          })
                        }
                      >
                        <svg>
                          <use
                            href={m.form.label === t.value ? "#i-check" : "#i-plus"}
                          />
                        </svg>
                        {t.label}
                      </button>
                    ))}
                    {tagInput ? (
                      <span className="tx-tag tx-tag-field">
                        <TextInput
                          aria-label="نام لیبل جدید"
                          value={tagText}
                          onChange={(v) => setTagText(v.slice(0, 30))}
                          placeholder="لیبل جدید…"
                          maxLength={30}
                          autoFocus
                        />
                        <button
                          type="button"
                          aria-label="ثبت لیبل"
                          onClick={applyCustomLabel}
                        >
                          <svg>
                            <use href="#i-check" />
                          </svg>
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="tx-tag tx-tag-add"
                        aria-label="لیبل جدید"
                        onClick={() => setTagInput(true)}
                      >
                        <svg>
                          <use href="#i-plus" />
                        </svg>
                        لیبل
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {/* نوار تصاویر پیوست */}
            {m.photos.length ? (
              <div className="tx-photos-strip">
                {m.photos.map((p) => (
                  <div className="tx-photo-mini" key={p.key}>
                    <a
                      href={p.existing?.url ?? p.dataUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="مشاهده تصویر"
                    >
                      <img
                        src={p.existing?.url ?? p.dataUrl}
                        alt={p.caption || "تصویر تراکنش"}
                      />
                    </a>
                    <button
                      type="button"
                      aria-label="حذف تصویر"
                      onClick={() => void m.removePhoto(p.key)}
                    >
                      <svg>
                        <use href="#i-x" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="tx-keypad-zone">
              <CalcKeypad value={m.form.amount} onChange={m.setAmount} />
              {!m.serviceExpense ? <button
                type="button"
                className="tx-scan-btn"
                onClick={() => photoFileRef.current?.click()}
              >
                <svg>
                  <use href="#i-image" />
                </svg>
                افزودن تصویر رسید
              </button> : null}
            </div>
          </>
        )}

        <input
          ref={photoFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={m.busy}
          style={{ display: "none" }}
          onChange={(e) => {
            void m.addPhotoFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        </fieldset>
      </div>
    </Modal>
    <Modal open={m.open && !!m.balanceWarning} onClose={dismissBalanceWarning}
      overlayClassName="tx-balance-overlay" sheetClassName="tx-balance-popup" padded={false}>
      {m.balanceWarning ? <div ref={balanceWarningRef} className="tx-balance-warning" role="alertdialog" aria-modal="true"
        aria-labelledby={balanceTitleId} aria-describedby={balanceDescriptionId} tabIndex={-1} onKeyDown={handleBalanceKeyDown}>
        <h3 id={balanceTitleId}>موجودی کافی نیست</h3>
        <p id={balanceDescriptionId}>با ثبت این هزینه، موجودی حساب منفی می‌شود.</p>
        <p className="tx-balance-account">{m.balanceWarning.account.title}</p>
        <div className="tx-balance-result">
          <span>مانده پس از ثبت</span>
          <b className="tx-balance-remaining" dir="ltr">{formatExpressionValue(toDisplay(m.balanceWarning.remaining, m.entryCurrency))}</b>
          <span>{currencyDisplayLabel(m.entryCurrency)}</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={m.busy} onClick={dismissBalanceWarning}>اصلاح مبلغ</button>
          <button type="button" className="btn-primary" disabled={m.busy} onClick={() => m.save(refreshData, accounts.length, true)}>تأیید و ثبت</button>
        </div>
      </div> : null}
    </Modal>
    </>
  );
}
