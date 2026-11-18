import { useMemo, useRef, useState, useEffect, useLayoutEffect, type ChangeEvent, type KeyboardEvent } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card, Field, JalaliDateInput, Modal, Segmented, Select, TextInput,
  expressionInputCaret, formatExpressionValue, normalizeExpressionInput } from "@/shared/ui";
import { CATEGORIES } from "@/domain/category/category.catalog";
import type { Transaction, TxRepeat } from "@/domain/transaction/transaction.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { parseScheduledAmount, stoppedRecurringInput } from "@/domain/transaction/recurring.rules";
import { toDisplay } from "@/shared/lib/currency";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatISO, isoToJalali, jalaliToIso, parse, today } from "@/shared/lib/jalali";

type SchedType = "expense" | "income";
const TYPE_TABS: { value: SchedType; label: string }[] = [
  { value: "expense", label: "هزینه" }, { value: "income", label: "درآمد" },
];
const REPEATS: { value: TxRepeat; label: string }[] = [
  { value: "monthly", label: "ماهانه" }, { value: "weekly", label: "هفتگی" }, { value: "yearly", label: "سالانه" },
];
const NOTE_HINT: Record<SchedType, string> = {
  expense: "مثلاً: قسط وام مسکن", income: "مثلاً: حقوق ماهانه یا اجارهٔ مغازه",
};
interface ScheduledForm {
  type: SchedType;
  amount: string;
  category: string;
  note: string;
  date: string;
  repeat: TxRepeat;
  repeatEnd: string;
  currency: string;
}

export function ScheduledTxsCard() {
  const { useCases, txs, cur, member, family, customCategories, refreshData, offlineSession } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  const identity = `${member?.id ?? ""}:${family?.id ?? ""}`;
  const identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<ScheduledForm>(() => empty());
  const amountRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    const next = selection.current; selection.current = null;
    if (next && document.activeElement === amountRef.current) amountRef.current?.setSelectionRange(next.start, next.end);
  });

  function empty(): ScheduledForm {
    return { type: "expense", amount: "", category: CATEGORIES.find(item => item.type === "expense")?.id ?? "",
      note: "", date: formatISO(today()), repeat: "monthly", repeatEnd: "", currency: cur };
  }
  const scheduled = useMemo(() => sortTxDesc(txs.filter(tx => tx.repeat !== "none")), [txs]);
  const catOptions = useMemo(() => [...CATEGORIES.filter(category => category.type === form.type).map(category => ({ value: category.id, label: category.name })),
    ...customCategories.filter(category => category.type === form.type).map(category => ({ value: category.id, label: category.name }))], [form.type, customCategories]);
  const selectedCategory = catOptions.some(category => category.value === form.category) ? form.category : "";
  const resolveName = (id: string) => CATEGORIES.find(category => category.id === id)?.name
    ?? customCategories.find(category => category.id === id)?.name ?? "دستهٔ نامشخص";
  const canManage = (tx: Transaction) => member?.role === "owner" || member?.role === "admin" || member?.id === tx.memberId;
  const available = !!useCases && !!member && !offlineSession;
  function currentRequest() { const scope = identityRef.current; return () => mounted.current && identityRef.current === scope; }
  function begin() {
    if (!available || writing.current) return false;
    writing.current = true; setBusy(true); return true;
  }
  function finish(current: () => boolean) { writing.current = false; if (current()) setBusy(false); }
  function patch(values: Partial<ScheduledForm>) {
    if (writing.current) return;
    setForm(previous => ({ ...previous, ...values })); setFormError(null);
  }
  function openNew() { if (!available || writing.current) return; setForm(empty()); setFormError(null); setNotice(null); setOpen(true); }
  function close() { if (!writing.current) setOpen(false); }
  function changeType(type: SchedType) { patch({ type, category: CATEGORIES.find(category => category.type === type)?.id ?? "" }); }
  function changeAmount(raw: string, start: number, end = start) {
    if (writing.current) return;
    const formatted = normalizeExpressionInput(raw);
    selection.current = { start: expressionInputCaret(raw, formatted, start), end: expressionInputCaret(raw, formatted, end) };
    patch({ amount: formatted });
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
  async function save() {
    if (!available || writing.current) return;
    const amount = parseScheduledAmount(form.amount, form.currency);
    if (amount === null) return setFormError("مبلغ معتبر وارد کنید");
    if (!selectedCategory) return setFormError("دسته را انتخاب کنید");
    const note = form.note.trim();
    if (!note || note.length > 200) return setFormError("توضیحی تا ۲۰۰ کاراکتر بنویسید");
    const start = parse(form.date), end = parse(form.repeatEnd);
    if (!start) return setFormError("تاریخ شروع را انتخاب کنید");
    if (!REPEATS.some(repeat => repeat.value === form.repeat)) return setFormError("دورهٔ تکرار را انتخاب کنید");
    if (!end) return setFormError("تاریخ پایان تکرار را انتخاب کنید");
    const startIso = jalaliToIso(start), endIso = jalaliToIso(end);
    if (endIso < startIso) return setFormError("تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد");
    if (!begin()) return;
    const current = currentRequest(); let saved = false; setFormError(null);
    try {
      await useCases!.addTransaction.execute({ memberId: member!.id, type: form.type, amount, category: selectedCategory,
        date: startIso, time: null, note, accountId: null, toAccountId: null, subcategoryId: null,
        repeat: form.repeat, repeatEnd: endIso });
      if (!current()) return;
      saved = true; setOpen(false); setNotice("تراکنش تکرارشونده ثبت شد");
      await refreshData();
    } catch (error) {
      if (current()) {
        if (saved) setNotice("تراکنش ثبت شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید");
        else setFormError((error as Error).message || "ثبت تراکنش ناموفق بود");
      }
    } finally { finish(current); }
  }
  async function stop(tx: Transaction, label: string) {
    if (!available || writing.current || !canManage(tx)) return;
    if (!confirm(/* @copy-text recurring.stop */ `تکرار «${label}» متوقف شود؟ تراکنش‌های ثبت‌شده باقی می‌مانند.`)) return;
    if (!begin()) return;
    const current = currentRequest(); let stopped = false; setNotice(null);
    try {
      const rows = await useCases!.listTransactions.execute();
      if (!current()) return;
      const fresh = rows.find(item => item.id === tx.id);
      if (fresh && fresh.repeat !== "none") {
        if (!canManage(fresh)) return setNotice("اجازهٔ تغییر این تراکنش را ندارید");
        await useCases!.updateTransaction.execute(fresh.id, stoppedRecurringInput(fresh));
        if (!current()) return;
      }
      stopped = true; setNotice("تکرار متوقف شد؛ سابقهٔ مالی باقی ماند");
      await refreshData();
    } catch (error) {
      if (current()) setNotice(stopped ? "تکرار متوقف شد؛ اطلاعات صفحه تازه نشد. صفحه را بازخوانی کنید" : (error as Error).message || "توقف تکرار ناموفق بود");
    } finally { finish(current); }
  }

  return <>
    <Card title="تراکنش‌های زمان‌بندی‌شده">
      <button type="button" className="sched-add" disabled={busy || !available} onClick={openNew}>
        <span className="sched-add-ico"><svg><use href="#i-plus" /></svg></span>
        افزودن تراکنش تکرارشونده
      </button>
      {notice !== null ? <p className="field-error scheduled-notice" role="status">{notice}</p> : null}
      {scheduled.length ? <div className="scheduled-list" style={{ marginTop: 10 }}>
        {scheduled.map(tx => {
          const label = tx.note?.trim() || resolveName(tx.category);
          return <div className="scheduled-row" key={tx.id}>
            <span className="scheduled-repeat"><svg><use href="#i-repeat" /></svg>
              {REPEATS.find(repeat => repeat.value === tx.repeat)?.label ?? "تکرار نامشخص"}
              {tx.repeatEnd ? /* @copy-text recurring.until */ ` تا ${formatISO(isoToJalali(tx.repeatEnd))}` : ""}
            </span>
            <b className="scheduled-title">{label}</b>
            <span className="scheduled-amount">{formatExpressionValue(toDisplay(tx.amount, cur))} {currencyDisplayLabel(cur)}</span>
            {canManage(tx) ? <button type="button" className="scheduled-stop" disabled={busy || !available}
              aria-label={/* @copy-text recurring.stop_label */ `توقف تکرار ${label}`} onClick={() => void stop(tx, label)}>توقف</button> : null}
          </div>;
        })}
      </div> : <p className="modal-sub" style={{ marginTop: 10 }}>تراکنش تکرارشونده‌ای ندارید؛ قسط، حقوق یا اجاره را اینجا ثبت کنید.</p>}
    </Card>
    <Modal open={open} onClose={close} title="تراکنش تکرارشونده" sheetClassName="scheduled-form-sheet">
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="scheduled-fields" disabled={busy} aria-busy={busy}>
          <div className="sched-form">
            <Segmented value={form.type} onChange={changeType} options={TYPE_TABS} />
            <Field label="مبلغ"><div className="amt-field">
              <input ref={amountRef} type="text" className="num-input big" inputMode="decimal" aria-label="مبلغ تراکنش تکرارشونده"
                value={form.amount} onChange={amountChanged} onKeyDown={amountKeyDown} />
              <span className="cur-suffix">{currencyDisplayLabel(form.currency)}</span>
            </div></Field>
            <div className="sched-grid">
              <Field label="توضیح"><TextInput value={form.note} onChange={note => patch({ note })} aria-label="توضیح تراکنش تکرارشونده" placeholder={NOTE_HINT[form.type]} maxLength={200} /></Field>
              <Field label="دسته"><Select value={selectedCategory} onChange={category => patch({ category })} aria-label="دستهٔ تراکنش تکرارشونده"
                options={[{ value: "", label: "انتخاب دسته…" }, ...catOptions]} /></Field>
            </div>
            <div className="sched-when">
              <div className="sched-when-head"><svg><use href="#i-repeat" /></svg>زمان‌بندی تکرار</div>
              <div className="sched-grid">
                <Field label="دوره"><Select value={form.repeat} onChange={repeat => patch({ repeat: repeat as TxRepeat })} aria-label="دورهٔ تکرار" options={REPEATS} /></Field>
                <Field label="شروع"><JalaliDateInput value={form.date} onChange={date => patch({ date })} aria-label="تاریخ شروع تکرار" /></Field>
              </div>
              <Field label="پایان تکرار"><JalaliDateInput value={form.repeatEnd} onChange={repeatEnd => patch({ repeatEnd })} aria-label="تاریخ پایان تکرار" placeholder="تا چه زمانی تکرار شود؟" /></Field>
            </div>
            <p className="modal-sub">نوبت اول بدون حساب مشخص در تراکنش‌ها ثبت می‌شود؛ نوبت‌های بعدی نیاز به تأیید دارند.</p>
            {formError !== null ? <p className="field-error scheduled-form-error" role="alert">{formError}</p> : null}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={close}>انصراف</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "در حال ذخیره…" : "ثبت"}</button>
          </div>
        </fieldset>
      </form>
    </Modal>
  </>;
}
