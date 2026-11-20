import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { TxFormModel } from "../model/useTxFormModel";
import { transactionAccountChoices } from "../model/transactionAccounts";
import { useTransferFeeQuote } from "../model/useTransferFeeQuote";
import { BankPaymentFields } from "./BankPaymentFields";
import { SmsImportFeature } from "@/features/sms-import";
import { Modal, Select, TextInput, JalaliDateInput, expressionInputCaret, normalizeExpressionInput } from "@/shared/ui";
import { categoriesFor, CUSTOM_CATEGORY_ICON } from "@/domain/category/category.catalog";
import { TX_REPEATS, type TxRepeat } from "@/domain/transaction/transaction.types";
import { parseScheduledAmount } from "@/domain/transaction/recurring.rules";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatAccountAmount } from "@/shared/lib/format";
import "./TransactionForm.css";

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

export function TransactionFormFeature({ form: m, onImported }: {
  form: TxFormModel; onImported: () => void | Promise<void>;
}) {
  const { accounts, txs, subcategories, customCategories, member, refreshData, useCases } = useApp();
  const [showAll, setShowAll] = useState(false);
  const [showAddCat, setShowAddCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [tagText, setTagText] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const amountId = useId();
  const isTransfer = m.form.type === "transfer";
  const locked = m.busy || m.occurrencePending;
  const amount = parseScheduledAmount(m.form.amount, m.entryCurrency);
  const ownerId = m.editing && !m.recurringOccurrence ? m.editing.memberId : member?.id ?? "";
  const sourceAccount = accounts.find(account => account.id === m.form.accountId);
  const destinationAccount = accounts.find(account => account.id === m.form.toAccountId);
  const bankTransfer = isTransfer && sourceAccount?.kind === "bank" && destinationAccount?.kind === "bank";
  const bankExpense = m.form.type === "expense" && sourceAccount?.kind === "bank";
  const quote = useTransferFeeQuote(useCases, `${ownerId}:${m.open}:${m.form.type}:${m.form.accountId}:${m.form.toAccountId}`,
    m.open && (bankTransfer || bankExpense) && m.form.feeChoice === "yes" ? m.form.feeMethod : "", amount);
  const choices = transactionAccountChoices(accounts, txs, ownerId, amount, m.form.type !== "income", showAll || m.form.type === "income",
    m.editing?.id).filter(({ account, balance }) => m.form.type === "income" || account.kind !== "bank" || amount === null || balance >= amount + quote.rial / 10);
  const destinations = transactionAccountChoices(accounts, txs, null, null, false, showAll)
    .filter(row => row.account.id !== m.form.accountId);
  const cats = useMemo(() => isTransfer ? [] : [
    ...categoriesFor(m.form.type),
    ...customCategories.filter(category => category.type === m.form.type)
      .map(category => ({ id: category.id, name: category.name, icon: CUSTOM_CATEGORY_ICON })),
  ], [isTransfer, m.form.type, customCategories]);
  const tags = useMemo(() => {
    const history = subcategories.filter(item => item.category === m.form.categoryId)
      .map(item => ({ value: item.name, label: item.name }));
    return [...new Map([...QUICK_LABELS[m.form.type === "income" ? "income" : "expense"], ...history]
      .map(item => [item.value, item])).values()].slice(0, 8);
  }, [subcategories, m.form.categoryId, m.form.type]);
  function accountOptions(rows: typeof choices) {
    return rows.map(({ account, balance }) => ({ value: account.id,
      label: /* @copy-text transaction.account_choice */ `${account.title} · ${formatAccountAmount(balance, m.entryCurrency)} ${currencyDisplayLabel(m.entryCurrency)}`,
    }));
  }
  useLayoutEffect(() => {
    const next = selection.current; selection.current = null;
    if (next && document.activeElement === amountRef.current) amountRef.current?.setSelectionRange(next.start, next.end);
  });
  useEffect(() => {
    if (!m.open) { setShowAll(false); setShowAddCat(false); setNewCatName(""); setTagText(""); }
  }, [m.open]);
  useEffect(() => {
    if (m.receiptError && detailsRef.current) detailsRef.current.open = true;
  }, [m.receiptError]);
  const accountAvailable = choices.some(row => row.account.id === m.form.accountId);
  useEffect(() => {
    if (m.open && !locked && m.form.accountId && !accountAvailable) m.setForm(previous => ({ ...previous, accountId: "" }));
  }, [m.open, locked, m.form.accountId, accountAvailable]);
  const destinationAvailable = destinations.some(row => row.account.id === m.form.toAccountId);
  useEffect(() => {
    if (m.open && !locked && isTransfer && (sourceAccount?.kind === "wallet" || destinationAccount?.kind === "wallet")
      && (m.form.feeChoice || m.form.feeMethod)) m.setForm(previous => ({ ...previous, feeChoice: "", feeMethod: "" }));
  }, [m.open, locked, isTransfer, sourceAccount?.kind, destinationAccount?.kind, m.form.feeChoice, m.form.feeMethod]);
  useEffect(() => {
    if (m.open && !locked && isTransfer && m.form.toAccountId && !destinationAvailable)
      m.setForm(previous => ({ ...previous, toAccountId: "" }));
  }, [m.open, locked, isTransfer, m.form.toAccountId, destinationAvailable]);
  function changeAmount(raw: string, start: number, end = start) {
    const formatted = normalizeExpressionInput(raw);
    selection.current = { start: expressionInputCaret(raw, formatted, start), end: expressionInputCaret(raw, formatted, end) };
    m.setAmount(raw);
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
      event.preventDefault(); changeAmount(input.value.slice(0, start - 2) + input.value.slice(start), start - 2);
    } else if (event.key === "Delete" && input.value[start] === ",") {
      event.preventDefault(); changeAmount(input.value.slice(0, start) + input.value.slice(start + 2), start);
    }
  }
  const saveLabel = m.activity === "checkOccurrence" ? "در حال بررسی سررسید…"
    : m.activity === "checkBalance" ? "در حال بررسی حساب…" : m.busy ? "در حال ذخیره…"
      : m.occurrencePending ? m.occurrenceAcknowledged ? "ذخیرهٔ رسیدها" : "تأیید سررسید"
        : m.editing ? "ذخیرهٔ تغییرات" : m.form.type === "expense" ? "ثبت هزینه"
          : m.form.type === "income" ? "ثبت درآمد" : "ثبت انتقال";
  return <Modal open={m.open} onClose={m.close} padded={false} dragToClose sheetClassName="tx-sheet tx-simple-sheet">
    <form className="tx-simple" aria-busy={m.busy} onSubmit={event => { event.preventDefault(); void m.save(refreshData, accounts.filter(account => account.memberId === ownerId).length); }}>
      <header className="tx-simple-head">
        <h2>{m.occurrencePending ? "تکمیل نوبت ثبت‌شده" : m.editing ? "ویرایش تراکنش" : "تراکنش جدید"}</h2>
        <button type="button" className="icon-btn" aria-label="بستن" disabled={m.busy} onClick={m.close}><svg><use href="#i-x" /></svg></button>
      </header>
      {m.receiptError !== null ? <div className="tx-save-status" role="status">
        <p>تراکنش ذخیره شده است؛ با ذخیرهٔ دوباره، رسیدهای همین تراکنش تکمیل می‌شوند.</p><p>{m.receiptError}</p>
      </div> : null}
      {m.occurrencePending && !m.occurrenceAcknowledged ? <div className="tx-save-status" role="status">
        <p>تراکنش این نوبت ثبت شده؛ فقط تأیید سررسید باقی مانده است.</p><p>{m.occurrenceError}</p>
      </div> : null}
      <fieldset className="tx-simple-fields" disabled={locked}>
        <div className="tx-tabs" role="tablist" aria-label="نوع تراکنش">
          {TYPE_TABS.map(tab => <button key={tab.value} type="button" role="tab" aria-selected={m.form.type === tab.value}
            className={`tx-tab ${m.form.type === tab.value ? "on" : ""}`} disabled={m.serviceExpense || m.recurringOccurrence}
            onClick={() => m.setType(tab.value)}>{tab.label}</button>)}
        </div>
        <div className="tx-simple-amount">
          <label htmlFor={amountId}>{m.form.type === "expense" ? "مبلغ هزینه" : m.form.type === "income" ? "مبلغ درآمد" : "مبلغ انتقال"}</label>
          <div className="tx-simple-amount-row">
            <input ref={amountRef} id={amountId} className="tx-amount" dir="ltr" type="text" inputMode="decimal" autoComplete="off"
              placeholder="۰" value={m.form.amount} onChange={amountChanged} onKeyDown={amountKeyDown} />
            <button type="button" className="tx-currency-btn" aria-label="تغییر واحد ورودی مبلغ"
              onClick={() => m.switchEntryCurrency(m.entryCurrency === "تومان" ? "ریال" : "تومان")}>{currencyDisplayLabel(m.entryCurrency)}</button>
          </div>
          {m.form.amount && amount === null ? <p className="field-error" role="status">مبلغ را فقط با عدد وارد کنید</p> : null}
        </div>
        <div className="tx-simple-account">
          <label>{isTransfer ? "از حساب" : m.form.type === "income" ? "واریز به" : "پرداخت از"}
            <Select aria-label={isTransfer ? "حساب مبدأ" : "حساب تراکنش"} value={m.form.accountId} onChange={accountId => m.setForm(previous => ({ ...previous, accountId }))}
              options={[{ value: "", label: m.serviceExpense || m.recurringOccurrence ? "بدون حساب مشخص" : "انتخاب حساب…" }, ...accountOptions(choices)]} />
          </label>
          {!choices.length ? <p className="tx-simple-hint" role="status">حساب یا کیف‌پول قابل انتخابی نیست؛ مبلغ و موجودی یا فهرست همهٔ حساب‌ها را بررسی کنید.</p> : null}
          {isTransfer ? <label>به حساب<Select aria-label="حساب مقصد" value={m.form.toAccountId}
            onChange={toAccountId => m.setForm(previous => ({ ...previous, toAccountId }))}
            options={[{ value: "", label: "انتخاب حساب مقصد…" }, ...accountOptions(destinations)]} /></label> : null}
          {m.form.type !== "income" ? <button type="button" className="tx-all-accounts" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
            {showAll ? "فهرست کوتاه حساب‌ها" : "نمایش همهٔ حساب‌های من"}
          </button> : null}
        </div>
        {bankTransfer || bankExpense ? <BankPaymentFields mode={bankExpense ? "expense" : "transfer"}
          choice={m.form.feeChoice} method={m.form.feeMethod} loading={quote.loading} error={quote.error}
          onChoice={feeChoice => m.setForm(previous => ({ ...previous, feeChoice, feeMethod: feeChoice === "no" ? "" : previous.feeMethod }))}
          onMethod={feeMethod => m.setForm(previous => ({ ...previous, feeMethod }))} /> : null}
        {!isTransfer ? <div className="tx-simple-category">
          <label>دسته‌بندی<Select aria-label="دسته‌بندی تراکنش" value={m.form.categoryId} disabled={m.serviceExpense}
            onChange={categoryId => m.setForm(previous => ({ ...previous, categoryId, label: "" }))}
            options={[{ value: "", label: "انتخاب دسته…" }, ...cats.map(cat => ({ value: cat.id, label: cat.name }))]} /></label>
          {!m.serviceExpense ? <button type="button" className="link-btn" aria-expanded={showAddCat} onClick={() => setShowAddCat(value => !value)}>دسته جدید</button> : null}
          {showAddCat ? <div className="tx-add-cat">
            <TextInput aria-label="نام دستهٔ جدید" value={newCatName} onChange={value => { setNewCatName(value); m.clearCategoryError(); }} maxLength={30} />
            <button type="button" className="btn-secondary" onClick={async () => { if (await m.addCategory(newCatName, refreshData)) { setShowAddCat(false); setNewCatName(""); } }}>ثبت دسته</button>
          </div> : null}
          {m.categoryError !== null ? <p className="field-error" role="status">{m.categoryError}</p> : null}
        </div> : null}
        <details className="tx-simple-details" ref={detailsRef}>
          <summary>جزئیات بیشتر<span>تاریخ، تکرار، توضیح و رسید</span></summary>
          <div className="tx-details-body">
            <label>تاریخ و ساعت{m.serviceExpense ? <span>{m.form.date}</span> : <JalaliDateInput aria-label="تاریخ و ساعت تراکنش"
              value={m.form.date} onChange={m.setDate} time={m.form.time} onTimeChange={m.setTime} />}</label>
            <label>تکرار<Select aria-label="تکرار تراکنش" value={m.form.repeat} disabled={m.serviceExpense || m.recurringOccurrence}
              onChange={value => m.setRepeat(value as TxRepeat)} options={TX_REPEATS} /></label>
            {m.form.repeat !== "none" ? <label>پایان تکرار<JalaliDateInput aria-label="تاریخ پایان تکرار" value={m.form.repeatEnd} onChange={m.setRepeatEnd} /></label> : null}
            <label>توضیح<textarea aria-label="توضیح تراکنش" rows={2} maxLength={200} value={m.form.note}
              onChange={event => m.setForm(previous => ({ ...previous, note: event.target.value }))} placeholder="توضیح اختیاری" /></label>
            {!isTransfer ? <div className="tx-simple-tags">
              <p>برچسب</p><div className="tx-tags">{tags.map(tag => <button type="button" key={tag.value} className={`tx-tag ${m.form.label === tag.value ? "on" : ""}`}
                aria-pressed={m.form.label === tag.value} onClick={() => m.setForm(previous => ({ ...previous, label: previous.label === tag.value ? "" : tag.value }))}>{tag.label}</button>)}</div>
              <TextInput aria-label="نام لیبل جدید" value={tagText} onChange={setTagText} placeholder="برچسب دلخواه" maxLength={30} />
              <button type="button" className="link-btn" onClick={() => { if (tagText.trim()) m.setForm(previous => ({ ...previous, label: tagText.trim() })); }}>ثبت لیبل</button>
              {m.form.label ? <p>{m.form.label}</p> : null}
            </div> : null}
            {!m.serviceExpense ? <button type="button" className="tx-scan-btn" onClick={() => fileRef.current?.click()}><svg><use href="#i-image" /></svg>افزودن تصویر رسید</button> : null}
            {m.photos.length ? <div className="tx-photos-strip">{m.photos.map(photo => <div key={photo.key} className="tx-photo-mini">
              <a href={photo.existing?.url ?? photo.dataUrl} target="_blank" rel="noreferrer" aria-label="مشاهده تصویر"><img src={photo.existing?.url ?? photo.dataUrl} alt={photo.caption || "تصویر تراکنش"} /></a>
              <button type="button" aria-label="حذف تصویر" onClick={() => void m.removePhoto(photo.key)}><svg><use href="#i-x" /></svg></button>
            </div>)}</div> : null}
            {m.serviceExpense ? <p className="tx-simple-hint">نوع، دسته و تاریخ هزینهٔ سرویس ثابت‌اند؛ رسید را از اسناد خانه ثبت کنید.</p> : null}
          </div>
        </details>
        {!m.editing && !m.recurringOccurrence && !isTransfer ? <div className="tx-simple-sms"><SmsImportFeature variant="row"
          onImported={async () => { await onImported(); m.close(); }} /></div> : null}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event => {
          void m.addPhotoFiles(Array.from(event.target.files ?? [])); event.target.value = "";
        }} />
      </fieldset>
      <footer className="tx-simple-footer">
        {m.editing && !m.recurringOccurrence && (m.editing.memberId === member?.id || member?.role === "owner" || member?.role === "admin")
          ? <button type="button" className="icon-btn danger" aria-label="حذف تراکنش" disabled={m.busy} onClick={() => void m.remove(refreshData)}><svg><use href="#i-trash" /></svg></button> : null}
        <button type="submit" className="btn-primary tx-simple-save" disabled={m.busy} aria-busy={m.busy}>{saveLabel}</button>
      </footer>
    </form>
  </Modal>;
}
