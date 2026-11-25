import { AppPage } from "@/shared/ui/AppPage";
import { addMoney } from "@/shared/lib/money";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* §۱.۹ — صفحهٔ قبوض و شارژ.

   قبض = **تعهدِ پرداخت‌نشده**. چیزی که این صفحه از صفحهٔ تراکنش‌ها جدا
   می‌کند همین است: این‌جا فهرستِ «چه چیزی را باید بدهیم» است، نه «چه چیزی
   را داده‌ایم». دلیلِ کاملش در `backend/alembic/versions/0010_bills.py`.

   دو قاعدهٔ ثبت‌شدهٔ این مخزن رعایت شده:
   • **لمسِ کارت → ویرایش** (آیکونِ جداگانهٔ ویرایش نداریم). حذف دکمهٔ خودش
     را دارد و `stopPropagation` می‌زند تا لمسش کارت را باز نکند.
   • تاریخ در ورودی **جلالی** است و در ذخیره **میلادی** — عیناً فرمِ تراکنش
     (`parse` → `jalaliToIso`). مبلغ هم با ارزِ عضو نمایش و با
   ضریب واحد پول و دقتِ ستونِ مبلغ ذخیره می‌شود.

   «پرداخت شد» تراکنشِ هزینه هم می‌سازد، پس بعدش `refreshData` لازم است:
   هم فهرستِ قبض عوض شده هم فهرستِ تراکنش و موجودیِ حساب. */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  Card,
  Field,
  Icon,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
  expressionInputCaret,
  formatExpressionValue,
  normalizeExpressionInput,
} from "@/shared/ui";
import type { Bill, BillKind } from "@/domain/bill/bill.types";
import { BILL_KINDS } from "@/domain/bill/bill.types";
import { isBillOverdue, parseBillAmount } from "@/domain/bill/bill.rules";
import { expenseBalanceWarning, sameExpenseBalance, type ExpenseBalanceWarning } from "@/features/transaction-form/model/expenseBalance";
import {
  formatISO,
  formatLong,
  isoToJalali,
  jalaliToIso,
  parse,
  today,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { toDisplay } from "@/shared/lib/currency";

interface FormState {
  kind: BillKind;
  title: string;
  amount: string;
  /** جلالی — «۱۴۰۵/۰۸/۱۵» */
  due: string;
  billNo: string;
  paymentNo: string;
  note: string;
}

const EMPTY: FormState = {
  kind: "electricity",
  title: "",
  amount: "",
  due: "",
  billNo: "",
  paymentNo: "",
  note: "",
};

export function BillsPage() {
  const { useCases, cur, accounts, members, bills, billDataStatus, member, family, refreshData } = useApp();
  const { show } = useToast();

  const [editing, setEditing] = useState<Bill | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [activity, setActivity] = useState<"save" | "checkBalance" | "pay" | "action" | "refresh" | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);
  const identity = `${member?.id ?? ""}:${family?.id ?? ""}`;
  const identityRef = useRef({ identity, useCases });
  if (identityRef.current.identity !== identity || identityRef.current.useCases !== useCases) identityRef.current = { identity, useCases };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [balanceWarning, setBalanceWarning] = useState<ExpenseBalanceWarning | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const amountSelection = useRef<{ start: number; end: number } | null>(null);
  const warningRef = useRef<HTMLDivElement>(null);
  const warningTitleId = useId();
  const warningDescriptionId = useId();
  const busy = activity !== null;
  const unavailable = billDataStatus !== "ready";
  /* قبضی که منتظرِ انتخابِ حساب برای پرداخت است */
  const [paying, setPaying] = useState<Bill | null>(null);
  const [payAccount, setPayAccount] = useState("");
  useEffect(() => {
    writing.current = false; amountSelection.current = null;
    setActivity(null); setOpen(false); setEditing(null); setForm(EMPTY);
    setPaying(null); setPayAccount(""); setBalanceWarning(null);
    setNotice(null); setFormError(null); setPayError(null);
  }, [identity, useCases]);

  useLayoutEffect(() => {
    const selection = amountSelection.current;
    amountSelection.current = null;
    if (selection && document.activeElement === amountRef.current) amountRef.current?.setSelectionRange(selection.start, selection.end);
  });
  useEffect(() => { if (balanceWarning) warningRef.current?.focus({ preventScroll: true }); }, [balanceWarning]);

  function currentRequest() {
    const scope = identityRef.current;
    return () => mounted.current && identityRef.current === scope;
  }
  function begin(next: NonNullable<typeof activity>) {
    if (!useCases || !member || writing.current || (next !== "refresh" && unavailable)) return false;
    writing.current = true;
    setActivity(next);
    return true;
  }
  function finish(current: () => boolean) {
    if (current()) { writing.current = false; setActivity(null); }
  }
  function patch(values: Partial<FormState>) {
    if (writing.current) return;
    setForm(previous => ({ ...previous, ...values }));
    setFormError(null);
  }
  function changeAmount(raw: string, start: number, end = start) {
    if (writing.current) return;
    const formatted = normalizeExpressionInput(raw);
    amountSelection.current = { start: expressionInputCaret(raw, formatted, start), end: expressionInputCaret(raw, formatted, end) };
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
      event.preventDefault();
      changeAmount(input.value.slice(0, start - 2) + input.value.slice(start), start - 2);
    } else if (event.key === "Delete" && input.value[start] === ",") {
      event.preventDefault();
      changeAmount(input.value.slice(0, start) + input.value.slice(start + 2), start);
    }
  }
  function closeForm() { if (!writing.current) setOpen(false); }
  function closePay() {
    if (writing.current || balanceWarning) return;
    setPaying(null);
    setPayError(null);
  }
  function dismissWarning() {
    if (writing.current) return;
    setBalanceWarning(null);
    requestAnimationFrame(() => document.querySelector<HTMLSelectElement>(".bill-pay-sheet select")?.focus());
  }
  function warningKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    event.preventDefault();
    const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
      : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
  async function reload() {
    if (!begin("refresh")) return;
    const current = currentRequest();
    try { await refreshData(); }
    catch { if (current()) setNotice("دریافت اطلاعات ممکن نشد؛ دوباره تلاش کنید"); }
    finally { finish(current); }
  }

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  /* ترتیب از سرور می‌آید (پرداخت‌نشده‌ها اول، به‌ترتیبِ سررسید)، پس این‌جا
     دوباره مرتب نمی‌کنیم — وگرنه دو مرجعِ ترتیب داشتیم. فقط جدا می‌کنیم. */
  const unpaid = bills.filter((b) => b.state === "unpaid");
  const settled = bills.filter((b) => b.state !== "unpaid");

  const totalUnpaid = addMoney(...unpaid.map(bill => bill.amount));
  const todayJ = today();
  const todayIso = jalaliToIso(todayJ);

  function openNew() {
    if (writing.current || unavailable) return;
    setEditing(null);
    setForm({ ...EMPTY, due: formatISO(todayJ) });
    setOpen(true);
    setFormError(null);
    setNotice(null);
  }

  function openEdit(bill: Bill) {
    if (writing.current || unavailable) return;
    /* قبضِ پرداخت‌شده ویرایش نمی‌شود (سرور هم ۴۰۹ می‌دهد): مبلغش با
       تراکنشش هم‌خوان است و تغییرش آن هم‌خوانی را می‌شکست. */
    if (bill.state === "paid") {
      show("قبض پرداخت‌شده ویرایش نمی‌شود — اول پرداخت را برگردانید");
      return;
    }
    setEditing(bill);
    setForm({
      kind: bill.kind,
      title: bill.title,
      amount: formatExpressionValue(toDisplay(bill.amount, cur)),
      due: formatISO(isoToJalali(bill.dueDate)),
      billNo: bill.billNo ?? "",
      paymentNo: bill.paymentNo ?? "",
      note: bill.note ?? "",
    });
    setOpen(true);
    setFormError(null);
    setNotice(null);
  }

  function openPay(bill: Bill) {
    if (writing.current || unavailable || bill.state !== "unpaid") return;
    setPaying(bill);
    setPayAccount("");
    setBalanceWarning(null);
    setPayError(null);
    setNotice(null);
  }

  async function save() {
    if (!useCases || writing.current || unavailable) return;
    const title = form.title.trim();
    if (!title) {
      setFormError("عنوان قبض را بنویسید");
      return;
    }
    const amount = parseBillAmount(form.amount, cur);
    if (amount === null) {
      setFormError("مبلغ قبض را درست وارد کنید");
      return;
    }
    const parsed = parse(form.due);
    if (!parsed) {
      setFormError("تاریخ سررسید را انتخاب کنید");
      return;
    }

    const input = {
      kind: form.kind,
      title,
      amount,
      dueDate: jalaliToIso(parsed),
      billNo: form.billNo.trim() || null,
      paymentNo: form.paymentNo.trim() || null,
      note: form.note.trim() || null,
    };

    if (!begin("save")) return;
    const current = currentRequest();
    setFormError(null);
    let saved = false;
    try {
      if (editing) await useCases.updateBill.execute(editing.id, input);
      else await useCases.addBill.execute(input);
      if (!current()) return;
      saved = true;
      setOpen(false);
      setNotice(editing ? "قبض به‌روز شد" : "قبض ثبت شد");
      await refreshData();
    } catch (e) {
      if (current()) {
        if (saved) setNotice("قبض ذخیره شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید");
        else setFormError((e as Error).message || "ذخیرهٔ قبض ناموفق بود");
      }
    } finally {
      finish(current);
    }
  }

  async function remove(bill: Bill) {
    if (!useCases || writing.current || unavailable || bill.state === "paid") return;
    if (!confirm(/* @copy-text bills.remove */ `قبض «${bill.title}» حذف شود؟`)) return;
    if (!begin("action")) return;
    const current = currentRequest();
    let deleted = false;
    try {
      await useCases.deleteBill.execute(bill.id);
      if (!current()) return;
      deleted = true;
      setNotice("قبض حذف شد");
      await refreshData();
    } catch (e) {
      if (current()) setNotice(deleted ? "قبض حذف شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید" : (e as Error).message || "حذف ناموفق بود");
    } finally {
      finish(current);
    }
  }

  async function confirmPay(confirmBalance = false) {
    if (!useCases || !paying || !begin("checkBalance")) return;
    const current = currentRequest();
    setPayError(null);
    let paid = false;
    let checking = true;
    try {
      const [freshBills, freshAccounts, transactions] = await Promise.all([
        useCases.listBills.execute(),
        payAccount ? useCases.listAccounts.execute() : Promise.resolve(accounts),
        payAccount ? useCases.listTransactions.execute() : Promise.resolve([]),
      ]);
      if (!current()) return;
      const fresh = freshBills.find(bill => bill.id === paying.id);
      if (!fresh || fresh.state !== "unpaid") {
        setBalanceWarning(null);
        setPaying(null);
        setNotice("این قبض دیگر پرداخت‌نشده نیست؛ اطلاعات تازه را بررسی کنید");
        await refreshData();
        return;
      }
      if (fresh.amount !== paying.amount || fresh.title !== paying.title) {
        setBalanceWarning(null);
        setPaying(fresh);
        setPayError("قبض تغییر کرده؛ مبلغ تازه را بررسی و دوباره تأیید کنید");
        return;
      }
      if (payAccount) {
        const account = freshAccounts.find(item => item.id === payAccount);
        if (!account || account.memberId !== member!.id || account.familyId !== family?.id) {
          setBalanceWarning(null);
          setPayError("حساب انتخاب‌شده در دسترس نیست؛ حساب دیگری انتخاب کنید");
          return;
        }
        const authoritative = await useCases!.walletCorrections.balance({ familyId: account.familyId, memberId: member!.id, accountId: account.id });
        if (!current()) return;
        const warning = expenseBalanceWarning(account, transactions, fresh.amount, undefined, authoritative.currentBalance);
        if (warning && (!confirmBalance || !sameExpenseBalance(balanceWarning, warning))) {
          setBalanceWarning(warning);
          return;
        }
      }
      setBalanceWarning(null);
      checking = false;
      setActivity("pay");
      await useCases.payBill.execute(paying.id, {
        accountId: payAccount || null,
      });
      if (!current()) return;
      paid = true;
      /* تراکنش هم ساخته شده، پس رفرشِ کامل لازم است نه فقط فهرستِ قبض */
      setPaying(null);
      setPayAccount("");
      setNotice("پرداخت ثبت شد و در هزینه‌ها آمد");
      await refreshData();
    } catch (e) {
      if (current()) {
        if (paid) setNotice("پرداخت ثبت شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید");
        else setPayError(checking ? "بررسی قبض و موجودی ممکن نشد؛ دوباره تلاش کنید" : (e as Error).message || "ثبت پرداخت ناموفق بود");
      }
    } finally {
      finish(current);
    }
  }

  async function undo(bill: Bill) {
    if (!useCases || writing.current || unavailable || bill.state !== "paid") return;
    if (member?.role !== "owner" && member?.role !== "admin" && bill.paidByMemberId !== member?.id) return;
    if (
      !confirm(
        "پرداخت برگردانده شود؟ تراکنشِ هزینه‌ای که ساخته شد هم حذف می‌شود.",
      )
    )
      return;
    if (!begin("action")) return;
    const current = currentRequest();
    let undone = false;
    try {
      await useCases.unpayBill.execute(bill.id);
      if (!current()) return;
      undone = true;
      setNotice("پرداخت برگشت");
      await refreshData();
    } catch (e) {
      if (current()) setNotice(undone ? "پرداخت برگشت؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید" : (e as Error).message || "برگرداندن ناموفق بود");
    } finally {
      finish(current);
    }
  }

  async function cancelBill(bill: Bill) {
    if (!useCases || writing.current || unavailable || bill.state !== "unpaid") return;
    if (!confirm(/* @copy-text bills.cancel */ `«${bill.title}» را پرداخت نمی‌کنید؟ هزینه‌ای ثبت نمی‌شود.`)) return;
    if (!begin("action")) return;
    const current = currentRequest();
    let cancelled = false;
    try {
      await useCases.cancelBill.execute(bill.id);
      if (!current()) return;
      cancelled = true;
      setNotice("قبض لغو شد");
      await refreshData();
    } catch (e) {
      if (current()) setNotice(cancelled ? "قبض لغو شد؛ اطلاعات صفحه تازه نشد. دوباره دریافت کنید" : (e as Error).message || "لغو ناموفق بود");
    } finally {
      finish(current);
    }
  }

  return (
    <AppPage className="page active bill-page">
      <header className="app-header">
        <div className="header-title">
          <h1>قبوض و شارژ</h1>
          <p>برق، آب، گاز، اینترنت و شارژ ساختمان</p>
        </div>
      </header>

      <div className="content">
        {notice !== null ? <p className="bill-notice" role="status">{notice}</p> : null}
        <BillReadNotice status={billDataStatus} busy={busy} onReload={() => void reload()} />
        <Card>
          {bills.length || billDataStatus === "ready" ? <div className="bill-summary">
            <p className="bill-summary-label">
              {unpaid.length
                ? `${toFa(unpaid.length)} قبض پرداخت‌نشده`
                : "قبض پرداخت‌نشده‌ای نداری"}
            </p>
            {unpaid.length ? (
              <b className="bill-summary-amount">
                {formatExpressionValue(toDisplay(totalUnpaid, cur))} {currencyDisplayLabel(cur)}
              </b>
            ) : null}
          </div> : null}
          <button type="button" className="btn-primary" disabled={busy || unavailable} onClick={openNew}>
            ثبت قبض جدید
          </button>
        </Card>

        {unpaid.length ? (
          <Card title="پرداخت‌نشده">
            <div className="bill-list">
              {unpaid.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  cur={cur}
                  overdue={isBillOverdue(b, todayIso)}
                  busy={busy || unavailable}
                  onOpen={() => openEdit(b)}
                  onPay={() => openPay(b)}
                  onCancel={() => void cancelBill(b)}
                  onDelete={() => void remove(b)}
                />
              ))}
            </div>
          </Card>
        ) : null}

        {settled.length ? (
          <Card title="پرداخت‌شده و لغوشده">
            <div className="bill-list">
              {settled.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  cur={cur}
                  overdue={false}
                  busy={busy || unavailable}
                  paidBy={
                    b.paidByMemberId
                      ? memberName.get(b.paidByMemberId)
                      : undefined
                  }
                  onOpen={() => openEdit(b)}
                  onUndo={b.state === "paid" && (member?.role === "owner" || member?.role === "admin" || b.paidByMemberId === member?.id) ? () => void undo(b) : undefined}
                  onDelete={
                    b.state === "cancelled" ? () => void remove(b) : undefined
                  }
                />
              ))}
            </div>
          </Card>
        ) : null}

        {!bills.length && billDataStatus === "ready" ? (
          <p className="modal-sub">
            هنوز قبضی ثبت نشده. قبض که آمد مبلغ و سررسیدش را این‌جا بگذار تا
            پیش از سررسید یادت بیاوریم.
          </p>
        ) : null}
      </div>

      {/* ── فرمِ ثبت/ویرایش ── */}
      <Modal
        open={open}
        onClose={closeForm}
        title={editing ? "ویرایش قبض" : "قبض جدید"}
        sheetClassName="bill-form-sheet"
        dragToClose={!busy}
      >
        <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="bill-fields" disabled={busy} aria-busy={busy}>
        <BillReadNotice status={billDataStatus} busy={busy} onReload={() => void reload()} />
        <Field label="نوع">
          <Select
            value={form.kind}
            aria-label="نوع قبض"
            onChange={(v) => patch({ kind: v as BillKind })}
            options={BILL_KINDS.map((k) => ({
              value: k.value,
              label: k.label,
            }))}
          />
        </Field>
        <Field label="عنوان">
          <TextInput
            value={form.title}
            aria-label="عنوان قبض"
            onChange={(v) => patch({ title: v })}
            maxLength={120}
            placeholder="مثلاً برق خانه"
          />
        </Field>
        <Field label={`مبلغ (${currencyDisplayLabel(cur)})`}>
          <input
            ref={amountRef}
            type="text"
            className="num-input"
            inputMode="decimal"
            aria-label="مبلغ قبض"
            value={form.amount}
            onChange={amountChanged}
            onKeyDown={amountKeyDown}
          />
        </Field>
        <Field label="سررسید">
          <JalaliDateInput
            value={form.due}
            aria-label="سررسید قبض"
            onChange={(v) => patch({ due: v })}
          />
        </Field>
        {/* شناسه‌ها اختیاری‌اند و برای شارژ ساختمان معمولاً وجود ندارند */}
        <Field label="شناسهٔ قبض (اختیاری)">
          <TextInput
            value={form.billNo}
            aria-label="شناسهٔ قبض"
            inputMode="numeric"
            dir="ltr"
            maxLength={40}
            onChange={(v) => patch({ billNo: v })}
            placeholder="روی برگهٔ قبض"
          />
        </Field>
        <Field label="شناسهٔ پرداخت (اختیاری)">
          <TextInput
            value={form.paymentNo}
            aria-label="شناسهٔ پرداخت"
            inputMode="numeric"
            dir="ltr"
            maxLength={40}
            onChange={(v) => patch({ paymentNo: v })}
          />
        </Field>
        <Field label="یادداشت (اختیاری)">
          <TextInput
            value={form.note}
            aria-label="یادداشت قبض"
            onChange={(v) => patch({ note: v })}
          />
        </Field>
        {formError !== null ? <p className="field-error bill-form-error" role="alert">{formError}</p> : null}
        <div className="modal-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={closeForm}>انصراف</button>
        <button
          type="submit"
          className="btn-primary"
          disabled={busy || unavailable}
        >
          {activity === "save" ? "در حال ذخیره…" : editing ? "ذخیرهٔ تغییرات" : "ثبت قبض"}
        </button>
        </div>
        </fieldset>
        </form>
      </Modal>

      {/* ── تأییدِ پرداخت: انتخابِ حساب ── */}
      <Modal
        open={paying !== null}
        onClose={closePay}
        title="ثبت پرداخت"
        sheetClassName="bill-pay-sheet"
        dragToClose={!busy && !balanceWarning}
      >
        <fieldset className="bill-fields" disabled={busy || !!balanceWarning} aria-busy={busy}>
        <BillReadNotice status={billDataStatus} busy={busy} onReload={() => void reload()} />
        <p className="modal-sub">
          {paying
            ? `${paying.title} — ${formatExpressionValue(
                toDisplay(paying.amount, cur),
              )} ${currencyDisplayLabel(cur)}`
            : ""}
        </p>
        {/* متن صریح است چون این کنش دو کار می‌کند و کاربر باید بداند */}
        <p className="modal-sub">
          این پرداخت در هزینه‌ها هم ثبت می‌شود.
        </p>
        <Field label="از کدام حساب؟ (اختیاری)">
          <Select
            value={payAccount}
            aria-label="حساب پرداخت قبض"
            onChange={value => { if (!writing.current) { setPayAccount(value); setBalanceWarning(null); setPayError(null); } }}
            options={[
              { value: "", label: "بدون حساب مشخص" },
              ...accounts.map((a) => ({ value: a.id, label: a.title })),
            ]}
          />
        </Field>
        {payError !== null ? <p className="field-error bill-pay-error" role="alert">{payError}</p> : null}
        <div className="modal-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={closePay}>انصراف</button>
        <button
          type="button"
          className="btn-primary"
          disabled={busy || unavailable}
          onClick={() => void confirmPay()}
        >
          {activity === "checkBalance" ? "در حال بررسی…" : activity === "pay" ? "در حال ثبت…" : "پرداخت شد"}
        </button>
        </div>
        </fieldset>
      </Modal>
      <Modal open={paying !== null && balanceWarning !== null} onClose={dismissWarning}
        overlayClassName="tx-balance-overlay" sheetClassName="tx-balance-popup" padded={false}>
        {balanceWarning ? <div ref={warningRef} className="tx-balance-warning" role="alertdialog" aria-modal="true"
          aria-labelledby={warningTitleId} aria-describedby={warningDescriptionId} tabIndex={-1} onKeyDown={warningKeyDown}>
          <h3 id={warningTitleId}>موجودی کافی نیست</h3>
          <p id={warningDescriptionId}>با ثبت این پرداخت، موجودی حساب منفی می‌شود.</p>
          <p className="tx-balance-account">{balanceWarning.account.title}</p>
          <div className="tx-balance-result">
            <span>مانده پس از پرداخت</span>
            <b className="tx-balance-remaining" dir="ltr">{formatExpressionValue(toDisplay(balanceWarning.remaining, cur))}</b>
            <span>{currencyDisplayLabel(cur)}</span>
          </div>
          {payError !== null ? <p role="alert">{payError}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={dismissWarning}>تغییر حساب</button>
            <button type="button" className="btn-primary" disabled={busy || unavailable} onClick={() => void confirmPay(true)}>تأیید و ثبت</button>
          </div>
        </div> : null}
      </Modal>
    </AppPage>
  );
}

function BillReadNotice({ status, busy, onReload }: {
  status: "loading" | "ready" | "error";
  busy: boolean;
  onReload: () => void;
}) {
  if (status === "loading") return <p className="modal-sub" role="status">در حال دریافت قبوض…</p>;
  if (status === "error") return <div className="bill-read-error" role="status">
    <p>دریافت قبوض ممکن نشد؛ دوباره تلاش کنید.</p>
    <button type="button" className="btn-secondary" disabled={busy} onClick={onReload}>دریافت دوباره</button>
  </div>;
  return null;
}

function BillRow({
  bill,
  cur,
  overdue,
  busy,
  paidBy,
  onOpen,
  onPay,
  onCancel,
  onUndo,
  onDelete,
}: {
  bill: Bill;
  cur: string;
  overdue: boolean;
  busy: boolean;
  paidBy?: string;
  onOpen: () => void;
  onPay?: () => void;
  onCancel?: () => void;
  onUndo?: () => void;
  onDelete?: () => void;
}) {
  const kind = BILL_KINDS.find((k) => k.value === bill.kind);
  const when = formatLong(isoToJalali(bill.dueDate));

  /* دکمه‌های درونی stopPropagation می‌زنند تا لمسشان کارت را باز نکند —
     قاعدهٔ ثبت‌شدهٔ «لمسِ ردیف → ویرایش». */
  const stop = (fn?: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn?.();
  };

  return (
    <div
      className={`bill-item${overdue ? " is-overdue" : ""}${
        bill.state === "cancelled" ? " is-cancelled" : ""
      }`}
      role="button"
      aria-label={/* @copy-text bills.open */ `مشاهدهٔ قبض ${bill.title}`}
      aria-disabled={busy}
      tabIndex={busy ? -1 : 0}
      onClick={() => { if (!busy) onOpen(); }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || busy) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <span className="bill-ic" aria-hidden="true">
        <Icon name={kind?.icon ?? "i-bill"} size={18} />
      </span>
      <div className="bill-info">
        <b>{bill.title}</b>
        <p>
          {kind?.label ?? "قبض"} · {when}
          {paidBy ? ` · پرداخت: ${paidBy}` : ""}
          {bill.state === "cancelled" ? " · لغو شده" : ""}
          {bill.state === "paid" ? " · پرداخت‌شده" : ""}
          {overdue ? " · سررسید گذشته" : ""}
        </p>
      </div>
      <div className="bill-side">
        <b className="bill-amount">{formatExpressionValue(toDisplay(bill.amount, cur))} {currencyDisplayLabel(cur)}</b>
        <div className="bill-actions">
          {onPay ? (
            <button
              type="button"
              className="bill-pay"
              disabled={busy}
              onClick={stop(onPay)}
            >
              پرداخت شد
            </button>
          ) : null}
          {onUndo ? (
            <button
              type="button"
              className="bill-undo"
              disabled={busy}
              onClick={stop(onUndo)}
            >
              برگرداندن
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="bill-skip"
              disabled={busy}
              onClick={stop(onCancel)}
            >
              نمی‌پردازم
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              className="bill-del"
              aria-label={/* @copy-text bills.delete_label */ `حذف قبض ${bill.title}`}
              disabled={busy}
              onClick={stop(onDelete)}
            >
              <Icon name="i-trash" size={15} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
