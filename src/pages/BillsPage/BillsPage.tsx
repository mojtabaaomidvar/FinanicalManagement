/* §۱.۹ — صفحهٔ قبوض و شارژ.

   قبض = **تعهدِ پرداخت‌نشده**. چیزی که این صفحه از صفحهٔ تراکنش‌ها جدا
   می‌کند همین است: این‌جا فهرستِ «چه چیزی را باید بدهیم» است، نه «چه چیزی
   را داده‌ایم». دلیلِ کاملش در `backend/alembic/versions/0010_bills.py`.

   دو قاعدهٔ ثبت‌شدهٔ این مخزن رعایت شده:
   • **لمسِ کارت → ویرایش** (آیکونِ جداگانهٔ ویرایش نداریم). حذف دکمهٔ خودش
     را دارد و `stopPropagation` می‌زند تا لمسش کارت را باز نکند.
   • تاریخ در ورودی **جلالی** است و در ذخیره **میلادی** — عیناً فرمِ تراکنش
     (`parse` → `jalaliToIso`). مبلغ هم با ارزِ عضو نمایش و با
     `fromDisplay` ذخیره می‌شود (§۶ الزامِ بازاستفادهٔ منطقِ ارز).

   «پرداخت شد» تراکنشِ هزینه هم می‌سازد، پس بعدش `refreshData` لازم است:
   هم فهرستِ قبض عوض شده هم فهرستِ تراکنش و موجودیِ حساب. */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  AmountInput,
  Card,
  Field,
  Icon,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import type { Bill, BillKind } from "@/domain/bill/bill.types";
import { BILL_KINDS } from "@/domain/bill/bill.types";
import {
  formatISO,
  formatLong,
  isoToJalali,
  jalaliToIso,
  parse,
  today,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";

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
  const { useCases, cur, accounts, members, bills, refreshData } = useApp();
  const { show } = useToast();

  const [editing, setEditing] = useState<Bill | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  /* قبضی که منتظرِ انتخابِ حساب برای پرداخت است */
  const [paying, setPaying] = useState<Bill | null>(null);
  const [payAccount, setPayAccount] = useState("");

  const memberName = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  /* ترتیب از سرور می‌آید (پرداخت‌نشده‌ها اول، به‌ترتیبِ سررسید)، پس این‌جا
     دوباره مرتب نمی‌کنیم — وگرنه دو مرجعِ ترتیب داشتیم. فقط جدا می‌کنیم. */
  const unpaid = bills.filter((b) => b.state === "unpaid");
  const settled = bills.filter((b) => b.state !== "unpaid");

  const totalUnpaid = unpaid.reduce((s, b) => s + b.amount, 0);
  const todayJ = today();

  function openNew() {
    setEditing(null);
    setForm({ ...EMPTY, due: formatISO(todayJ) });
    setOpen(true);
  }

  function openEdit(bill: Bill) {
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
      amount: formatAmount(toDisplay(bill.amount, cur)),
      due: formatISO(isoToJalali(bill.dueDate)),
      billNo: bill.billNo ?? "",
      paymentNo: bill.paymentNo ?? "",
      note: bill.note ?? "",
    });
    setOpen(true);
  }

  async function save() {
    if (!useCases || busy) return;
    const title = form.title.trim();
    if (!title) {
      show("عنوان قبض را بنویسید");
      return;
    }
    const display = parseAmountInput(form.amount);
    if (!display || display <= 0) {
      show("مبلغ قبض را درست وارد کنید");
      return;
    }
    const parsed = parse(form.due);
    if (!parsed) {
      show("تاریخ سررسید را انتخاب کنید");
      return;
    }

    const input = {
      kind: form.kind,
      title,
      /* نمایش → پایه (تومان). بی این تبدیل، کاربرِ ریالی مبلغ را ده‌برابر
         ذخیره می‌کرد. */
      amount: fromDisplay(display, cur),
      dueDate: jalaliToIso(parsed),
      billNo: form.billNo.trim() || null,
      paymentNo: form.paymentNo.trim() || null,
      note: form.note.trim() || null,
    };

    setBusy(true);
    try {
      if (editing) await useCases.updateBill.execute(editing.id, input);
      else await useCases.addBill.execute(input);
      await refreshData();
      setOpen(false);
      show(editing ? "قبض به‌روز شد" : "قبض ثبت شد");
    } catch (e) {
      show((e as Error).message || "ذخیرهٔ قبض ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function remove(bill: Bill) {
    if (!useCases || busy) return;
    if (!confirm(`قبض «${bill.title}» حذف شود؟`)) return;
    setBusy(true);
    try {
      await useCases.deleteBill.execute(bill.id);
      await refreshData();
      show("قبض حذف شد");
    } catch (e) {
      show((e as Error).message || "حذف ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPay() {
    if (!useCases || !paying || busy) return;
    setBusy(true);
    try {
      await useCases.payBill.execute(paying.id, {
        accountId: payAccount || null,
      });
      /* تراکنش هم ساخته شده، پس رفرشِ کامل لازم است نه فقط فهرستِ قبض */
      await refreshData();
      setPaying(null);
      setPayAccount("");
      show("پرداخت ثبت شد و در هزینه‌ها آمد");
    } catch (e) {
      show((e as Error).message || "ثبت پرداخت ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function undo(bill: Bill) {
    if (!useCases || busy) return;
    if (
      !confirm(
        "پرداخت برگردانده شود؟ تراکنشِ هزینه‌ای که ساخته شد هم حذف می‌شود.",
      )
    )
      return;
    setBusy(true);
    try {
      await useCases.unpayBill.execute(bill.id);
      await refreshData();
      show("پرداخت برگشت");
    } catch (e) {
      show((e as Error).message || "برگرداندن ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function cancelBill(bill: Bill) {
    if (!useCases || busy) return;
    if (!confirm(`«${bill.title}» را پرداخت نمی‌کنید؟`)) return;
    setBusy(true);
    try {
      await useCases.cancelBill.execute(bill.id);
      await refreshData();
      show("قبض لغو شد");
    } catch (e) {
      show((e as Error).message || "لغو ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>قبوض و شارژ</h1>
          <p>برق، آب، گاز، اینترنت و شارژ ساختمان</p>
        </div>
      </header>

      <div className="content">
        <Card>
          <div className="bill-summary">
            <p className="bill-summary-label">
              {unpaid.length
                ? `${toFa(unpaid.length)} قبض پرداخت‌نشده`
                : "قبض پرداخت‌نشده‌ای نداری"}
            </p>
            {unpaid.length ? (
              <b className="bill-summary-amount">
                {formatAmount(toDisplay(totalUnpaid, cur))} {cur}
              </b>
            ) : null}
          </div>
          <button type="button" className="btn-primary" onClick={openNew}>
            ثبت قبض تازه
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
                  overdue={isoToJalali(b.dueDate) < todayJ}
                  busy={busy}
                  onOpen={() => openEdit(b)}
                  onPay={() => {
                    setPaying(b);
                    setPayAccount("");
                  }}
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
                  busy={busy}
                  paidBy={
                    b.paidByMemberId
                      ? memberName.get(b.paidByMemberId)
                      : undefined
                  }
                  onOpen={() => openEdit(b)}
                  onUndo={b.state === "paid" ? () => void undo(b) : undefined}
                  onDelete={
                    b.state === "cancelled" ? () => void remove(b) : undefined
                  }
                />
              ))}
            </div>
          </Card>
        ) : null}

        {!bills.length ? (
          <p className="modal-sub">
            هنوز قبضی ثبت نشده. قبض که آمد مبلغ و سررسیدش را این‌جا بگذار تا
            پیش از سررسید یادت بیاوریم.
          </p>
        ) : null}
      </div>

      {/* ── فرمِ ثبت/ویرایش ── */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "ویرایش قبض" : "قبض تازه"}
        dragToClose
      >
        <Field label="نوع">
          <Select
            value={form.kind}
            onChange={(v) => setForm((f) => ({ ...f, kind: v as BillKind }))}
            options={BILL_KINDS.map((k) => ({
              value: k.value,
              label: k.label,
            }))}
          />
        </Field>
        <Field label="عنوان">
          <TextInput
            value={form.title}
            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
            placeholder="مثلاً برق خانه"
          />
        </Field>
        <Field label={`مبلغ (${cur})`}>
          <AmountInput
            value={form.amount}
            onChange={(v) => setForm((f) => ({ ...f, amount: v }))}
          />
        </Field>
        <Field label="سررسید">
          <JalaliDateInput
            value={form.due}
            onChange={(v) => setForm((f) => ({ ...f, due: v }))}
          />
        </Field>
        {/* شناسه‌ها اختیاری‌اند و برای شارژ ساختمان معمولاً وجود ندارند */}
        <Field label="شناسهٔ قبض (اختیاری)">
          <TextInput
            value={form.billNo}
            onChange={(v) => setForm((f) => ({ ...f, billNo: v }))}
            placeholder="روی برگهٔ قبض"
          />
        </Field>
        <Field label="شناسهٔ پرداخت (اختیاری)">
          <TextInput
            value={form.paymentNo}
            onChange={(v) => setForm((f) => ({ ...f, paymentNo: v }))}
          />
        </Field>
        <Field label="یادداشت (اختیاری)">
          <TextInput
            value={form.note}
            onChange={(v) => setForm((f) => ({ ...f, note: v }))}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "…" : editing ? "ذخیرهٔ تغییرات" : "ثبت قبض"}
        </button>
      </Modal>

      {/* ── تأییدِ پرداخت: انتخابِ حساب ── */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title="ثبت پرداخت"
        dragToClose
      >
        <p className="modal-sub">
          {paying
            ? `${paying.title} — ${formatAmount(
                toDisplay(paying.amount, cur),
              )} ${cur}`
            : ""}
        </p>
        {/* متن صریح است چون این کنش دو کار می‌کند و کاربر باید بداند */}
        <p className="modal-sub">
          با ثبت پرداخت، یک هزینه در دستهٔ «قبض» هم ساخته می‌شود تا خرج ماه
          درست بماند.
        </p>
        <Field label="از کدام حساب؟ (اختیاری)">
          <Select
            value={payAccount}
            onChange={setPayAccount}
            options={[
              { value: "", label: "مشخص نیست / نقدی" },
              ...accounts.map((a) => ({ value: a.id, label: a.title })),
            ]}
          />
        </Field>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => void confirmPay()}
        >
          {busy ? "…" : "پرداخت شد"}
        </button>
      </Modal>
    </section>
  );
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
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
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
        </p>
      </div>
      <div className="bill-side">
        <b className="bill-amount">{formatAmount(toDisplay(bill.amount, cur))}</b>
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
              aria-label="حذف"
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
