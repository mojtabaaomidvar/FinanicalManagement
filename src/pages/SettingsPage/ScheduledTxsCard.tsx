/* تراکنش‌های تکرارشونده — فیچر مستقل تنظیمات
   ──────────────────────────────────────────
   تا امروز فقط فهرست بود و تراکنش تکرارشونده را باید از شیت «+» ثبت
   می‌کردید. حالا همین‌جا هم ساخته می‌شود و — برخلاف شیت عمومی — «پریود
   تکرار» و «تاریخ پایان» هر دو اجباری‌اند؛ چون تراکنشی که اینجا ساخته
   می‌شود اساساً یک تعهد دوره‌ای است (قسط، حقوق، اجاره…). */

import { useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import {
  AmountInput,
  Card,
  Field,
  JalaliDateInput,
  Modal,
  Segmented,
  Select,
  TextInput,
} from "@/shared/ui";
import { CATEGORIES } from "@/domain/category/category.catalog";
import type { TxRepeat } from "@/domain/transaction/transaction.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { formatAmount, parseAmountInput } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import { formatISO, isoToJalali, jalaliToIso, parse, today } from "@/shared/lib/jalali";

type SchedType = "expense" | "income";

const TYPE_TABS: { value: SchedType; label: string }[] = [
  { value: "expense", label: "هزینه" },
  { value: "income", label: "درآمد" },
];

/* «بدون تکرار» عمداً نیست — اینجا پریود اجباری است */
const REPEATS: { value: TxRepeat; label: string }[] = [
  { value: "monthly", label: "ماهانه" },
  { value: "weekly", label: "هفتگی" },
  { value: "yearly", label: "سالانه" },
];

const REPEAT_FA: Record<string, string> = {
  weekly: "هفتگی",
  monthly: "ماهانه",
  yearly: "سالانه",
};

/* مثالِ توضیح بسته به نوع فرق می‌کند — تعهد دوره‌ای هزینه با درآمد یکی نیست */
const NOTE_HINT: Record<SchedType, string> = {
  expense: "مثلاً: قسط وام مسکن",
  income: "مثلاً: حقوق ماهانه یا اجارهٔ مغازه",
};

export function ScheduledTxsCard() {
  const { useCases, txs, cur, member, customCategories, refreshData } =
    useApp();
  const { show } = useToast();

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [type, setType] = useState<SchedType>("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(formatISO(today()));
  const [repeat, setRepeat] = useState<TxRepeat>("monthly");
  const [repeatEnd, setRepeatEnd] = useState("");

  const scheduled = useMemo(
    () => sortTxDesc(txs.filter((t) => t.repeat && t.repeat !== "none")),
    [txs],
  );

  const catOptions = useMemo(() => {
    const base = CATEGORIES.filter((c) => c.type === type).map((c) => ({
      value: c.id,
      label: c.name,
    }));
    const customs = customCategories
      .filter((c) => c.type === type)
      .map((c) => ({ value: c.id, label: c.name }));
    return [...base, ...customs];
  }, [type, customCategories]);

  const resolveName = (id: string) =>
    CATEGORIES.find((c) => c.id === id)?.name ??
    customCategories.find((c) => c.id === id)?.name ??
    id;

  function openNew() {
    /* تراکنش تکرارشونده یک تعهد دوره‌ای است؛ حساب و عضو دیگر پرسیده
       نمی‌شوند — حساب null می‌ماند و رکورد به خودِ مدیر نسبت می‌گیرد */
    setType("expense");
    setAmount("");
    setCategory(CATEGORIES.find((c) => c.type === "expense")?.id ?? "");
    setNote("");
    setDate(formatISO(today()));
    setRepeat("monthly");
    setRepeatEnd("");
    setOpen(true);
  }

  function changeType(next: SchedType) {
    setType(next);
    /* دستهٔ قبلی به نوع تازه نمی‌خورد — اولین دستهٔ همان نوع */
    setCategory(CATEGORIES.find((c) => c.type === next)?.id ?? "");
  }

  async function save() {
    const value = parseAmountInput(amount);
    if (!value || value <= 0) return show("مبلغ را وارد کنید");
    if (!category) return show("دسته را انتخاب کنید");
    /* حساب و عضو اختیاری‌اند؛ اما توضیح اجباری است تا این تعهد دوره‌ای
       در فهرست و در پیام تأیید سررسید قابل‌تشخیص باشد */
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      return show("توضیح را بنویسید — مثلاً «قسط وام مسکن» یا «حقوق ماهانه»");
    }

    const start = parse(date);
    if (!start) return show("تاریخ شروع را انتخاب کنید");

    /* هر دو اجباری‌اند — همین تفاوت این فرم با شیت عمومی ثبت است */
    if (!repeat || repeat === "none") return show("پریود تکرار را انتخاب کنید");
    const end = parse(repeatEnd);
    if (!end) {
      return show("تاریخ پایان تکرار اجباری است — تا چه زمانی تکرار شود؟");
    }
    const startIso = jalaliToIso(start);
    const endIso = jalaliToIso(end);
    if (endIso < startIso) {
      return show("تاریخ پایان نمی‌تواند قبل از تاریخ شروع باشد");
    }

    setBusy(true);
    try {
      await useCases!.addTransaction.execute({
        /* رکورد باید صاحب داشته باشد → به خودِ مدیرِ سازنده نسبت می‌گیرد */
        memberId: member?.id || "",
        type,
        amount: fromDisplay(value, cur),
        category,
        date: startIso,
        time: null,
        note: trimmedNote,
        accountId: null,
        toAccountId: null,
        subcategoryId: null,
        repeat,
        repeatEnd: endIso,
      });
      show("تراکنش تکرارشونده ثبت شد");
      setOpen(false);
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در ثبت");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`«${label}» از تراکنش‌های تکرارشونده حذف شود؟`)) return;
    try {
      await useCases!.deleteTransaction.execute(id);
      show("حذف شد");
      await refreshData();
    } catch (e) {
      show((e as Error).message || "خطا در حذف");
    }
  }

  return (
    <>
      <Card title="تراکنش‌های زمان‌بندی‌شده">
        <button type="button" className="sched-add" onClick={openNew}>
          <span className="sched-add-ico">
            <svg>
              <use href="#i-plus" />
            </svg>
          </span>
          افزودن تراکنش تکرارشونده
        </button>

        {scheduled.length ? (
          <div className="scheduled-list" style={{ marginTop: 10 }}>
            {scheduled.map((t) => {
              const label = t.note || resolveName(t.category);
              return (
                <div className="scheduled-row" key={t.id}>
                  <span className="scheduled-repeat">
                    <svg>
                      <use href="#i-repeat" />
                    </svg>
                    {REPEAT_FA[t.repeat] ?? t.repeat}
                    {t.repeatEnd
                      ? ` تا ${formatISO(isoToJalali(t.repeatEnd))}`
                      : ""}
                  </span>
                  <b className="scheduled-title">{label}</b>
                  <span className="scheduled-amount">
                    {formatAmount(toDisplay(t.amount, cur))} {cur}
                  </span>
                  <button
                    type="button"
                    className="scheduled-del"
                    aria-label={`حذف ${label}`}
                    onClick={() => void remove(t.id, label)}
                  >
                    <svg>
                      <use href="#i-trash" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="modal-sub" style={{ marginTop: 10 }}>
            تراکنش تکرارشونده‌ای ندارید — قسط وام، حقوق ماهانه یا اجاره را
            یک‌بار اینجا ثبت کنید.
          </p>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="تراکنش تکرارشونده"
      >
        <div className="sched-form">
          <Segmented value={type} onChange={changeType} options={TYPE_TABS} />

          {/* مبلغ — کارت شاخص بالای فرم */}
          <Field label="مبلغ">
            <AmountInput value={amount} onChange={setAmount} currency={cur} big />
          </Field>

          {/* توضیح و دسته کنار هم — جفتِ «چیست» */}
          <div className="sched-grid">
            <Field label="توضیح">
              <TextInput
                value={note}
                onChange={setNote}
                placeholder={NOTE_HINT[type]}
                maxLength={60}
              />
            </Field>
            <Field label="دسته">
              <Select
                value={category}
                onChange={setCategory}
                options={catOptions}
              />
            </Field>
          </div>

          {/* بلوکِ زمان‌بندی — یک قابِ نرم که سه فیلد تکرار را جمع می‌کند */}
          <div className="sched-when">
            <div className="sched-when-head">
              <svg>
                <use href="#i-repeat" />
              </svg>
              زمان‌بندی تکرار
            </div>
            <div className="sched-grid">
              <Field label="پریود">
                <Select
                  value={repeat}
                  onChange={(v) => setRepeat(v as TxRepeat)}
                  options={REPEATS}
                />
              </Field>
              <Field label="شروع">
                <JalaliDateInput value={date} onChange={setDate} />
              </Field>
            </div>
            <Field label="پایان تکرار">
              <JalaliDateInput
                value={repeatEnd}
                onChange={setRepeatEnd}
                placeholder="تا چه زمانی تکرار شود؟"
              />
            </Field>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setOpen(false)}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "…" : "ثبت"}
          </button>
        </div>
      </Modal>
    </>
  );
}
