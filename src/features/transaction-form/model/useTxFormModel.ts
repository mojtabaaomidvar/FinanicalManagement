/* مدل فرم تراکنش — افزودن/ویرایش با اعتبارسنجی */

import { useEffect, useRef, useState } from "react";
import type { Subcategory } from "@/domain/category/subcategory.types";
import type {
  Transaction,
  TxRepeat,
  TransferFeeMethod,
  PaymentMethod,
} from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import type { Member } from "@/domain/family/family.types";
import { defaultCategoryOf } from "@/domain/category/category.catalog";
import { parse } from "@/shared/lib/jalali";
import { jalaliToIso } from "@/shared/lib/jalali";
import {
  liveFormatJalaliDate,
  nowTime,
} from "@/shared/lib/format";
import { normalizeExpressionInput, formatExpressionValue } from "@/shared/ui";
import { compressImage } from "@/shared/lib/image";
import { toDisplay } from "@/shared/lib/currency";
import { addMoney, compareMoney, convertMoney, moneyFits, multiplyMoney } from "@/shared/lib/money";
import { isoToJalali, today, formatISO } from "@/shared/lib/jalali";
import { expenseBalanceWarning, type ExpenseBalanceWarning } from "./expenseBalance";
import { occurrenceStatus, parseScheduledAmount, recurringTemplate } from "@/domain/transaction/recurring.rules";
import { clearPendingOccurrence, readPendingOccurrence, rememberPendingOccurrence } from "./pendingOccurrence";

export interface TxFormState {
  type: "expense" | "income" | "transfer";
  amount: string;
  categoryId: string;
  date: string;
  /** ساعت ثبت — "HH:MM" یا "" */
  time: string;
  memberId: string;
  note: string;
  /** حساب منشا (هزینه/انتقال) یا مقصد واریز (درآمد) — الزامی */
  accountId: string;
  /** حساب مقصد انتقال — الزامی برای type=transfer */
  toAccountId: string;
  feeChoice: "" | "yes" | "no";
  paymentMethod: "" | PaymentMethod;
  feeMethod: "" | TransferFeeMethod;
  /** لیبل آزاد (زیردسته) — اختیاری؛ در صورت پر بودن ساخته/یافته می‌شود */
  label: string;
  /** دوره تکرار */
  repeat: TxRepeat;
  /** تاریخ پایان تکرار — الزامی وقتی repeat ≠ none ("۱۴۰۴/۰۶/۱۵") */
  repeatEnd: string;
}

/** تصویر پیوست در فرم — موجود (سمت سرور) یا در صف آپلود */
export interface TxPhotoItem {
  key: string;
  existing?: { id: string; url: string; caption: string | null };
  dataUrl?: string;
  /** Keep a successful upload when linking the receipt needs another attempt. */
  uploadedUrl?: string;
  caption: string;
}

const MAX_PHOTOS = 8;

export function useTxFormModel(
  useCases: UseCases,
  members: Member[],
  currentMemberId: string,
  notify: (m: string) => void,
  currency: string = "تومان",
  subcategories: Subcategory[] = [],
) {
  const saving = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const scope = useRef({ currentMemberId, useCases });
  if (scope.current.currentMemberId !== currentMemberId || scope.current.useCases !== useCases) {
    scope.current = { currentMemberId, useCases };
  }
  const savedTransaction = useRef<Transaction | null>(null);
  const reviewedBalance = useRef<ExpenseBalanceWarning | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const serviceExpense = editing?.sourceKind === "vehicle_service";
  const [open, setOpen] = useState(false);
  const [fullscreenOnMobile, setFullscreenOnMobile] = useState(false);
  const [form, writeForm] = useState<TxFormState>(defaults());
  const [photos, setPhotos] = useState<TxPhotoItem[]>([]);
  const [activity, setActivity] = useState<"checkBalance" | "checkOccurrence" | "save" | "saveCategory" | "delete" | "preparePhotos" | "removePhoto" | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const busy = activity !== null;
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [balanceWarning, setBalanceWarning] = useState<ExpenseBalanceWarning | null>(null);
  const [occurrenceError, setOccurrenceError] = useState<string | null>(null);
  /* وقتی فرم برای «تحقق» یک سررسید تراکنش تکرارشونده باز شده باشد:
     تراکنش واقعی جدید ثبت می‌شود و بعد همان سررسید علامت رسیدگی می‌خورد
     تا دوباره پرسیده نشود. (بخش ۳.۲) */
  const [occurrence, setOccurrence] = useState<{
    recurringId: string;
    dueDate: string;
    familyId: string;
    acknowledged?: boolean;
  } | null>(null);
  const occurrencePending = occurrence !== null && editing !== null;
  /** ارز ورودی مبلغ — مستقل از ارز اصلی، همان لحظه ثبت */
  const [entryCurrency, setEntryCurrency] = useState<string>(currency);

  function setForm(update: Parameters<typeof writeForm>[0]) {
    if (!saving.current && !occurrencePending) {
      setCategoryError(null);
      reviewedBalance.current = null;
      setBalanceWarning(null);
      writeForm(previous => {
        const next = typeof update === "function" ? update(previous) : update;
        return next.accountId !== previous.accountId || next.toAccountId !== previous.toAccountId || next.type !== previous.type
          ? { ...next, feeChoice: "", feeMethod: "", paymentMethod: "" } : next;
      });
    }
  }

  function currentRequest() {
    const capturedScope = scope.current;
    const capturedGeneration = generation.current;
    return () => mounted.current && scope.current === capturedScope && generation.current === capturedGeneration;
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  useEffect(() => {
    generation.current += 1;
    saving.current = false;
    savedTransaction.current = null;
    reviewedBalance.current = null;
    setBalanceWarning(null);
    setActivity(null); setOpen(false); setEditing(null); setOccurrence(null);
    setPhotos([]); setReceiptError(null); writeForm(defaults());
    setCategoryError(null);
    setOccurrenceError(null);
  }, [currentMemberId, useCases]);

  function defaults(): TxFormState {
    return {
      type: "expense",
      amount: "",
      categoryId: "" /* بدون دسته → گرید انتخاب دسته نمایش داده می‌شود */,
      date: formatISO(today()),
      time: nowTime(),
      memberId: currentMemberId,
      note: "",
      accountId: "",
      toAccountId: "",
      feeChoice: "",
      paymentMethod: "",
      feeMethod: "",
      label: "",
      repeat: "none",
      repeatEnd: "",
    };
  }

  function openNew(options: { fullscreenOnMobile?: boolean } = {}) {
    if (saving.current) return;
    generation.current += 1;
    savedTransaction.current = null;
    setFullscreenOnMobile(options.fullscreenOnMobile ?? false);
    setEditing(null);
    setOccurrence(null);
    setOccurrenceError(null);
    writeForm(defaults());
    setPhotos([]);
    setReceiptError(null);
    setCategoryError(null);
    setEntryCurrency(currency);
    setOpen(true);
  }

  function openEdit(tx: Transaction) {
    setFullscreenOnMobile(false);
    if (saving.current) return;
    if (tx.sourceKind === "transfer_fee") return notify("برای تغییر کارمزد، پرداخت اصلی را ویرایش کنید.");
    if (tx.sourceKind === "wallet_correction") return notify("تراکنش اصلاح موجودی تغییرناپذیر است؛ اصلاح تازه را از کیف پول ثبت کنید.");
    generation.current += 1;
    savedTransaction.current = tx;
    setEditing(tx);
    setOccurrence(null);
    setOccurrenceError(null);
    writeForm({
      type: tx.type,
      amount: formatExpressionValue(toDisplay(tx.amount, currency)),
      categoryId: tx.category,
      date: formatISO(isoToJalali(tx.date)),
      time: tx.time ?? "",
      memberId: tx.memberId,
      note: tx.note ?? "",
      accountId: tx.accountId ?? "",
      toAccountId: tx.toAccountId ?? "",
      feeChoice: tx.transferFeeMethod ? "yes" : tx.type === "expense" ? "" : "no",
      paymentMethod: tx.paymentMethod ?? (tx.transferFeeMethod && tx.type === "expense" ? "bank_transfer" : ""),
      feeMethod: tx.transferFeeMethod ?? "",
      label: subcategories.find((s) => s.id === tx.subcategoryId)?.name ?? "",
      repeat: tx.repeat,
      repeatEnd: tx.repeatEnd ? formatISO(isoToJalali(tx.repeatEnd)) : "",
    });
    setPhotos(
      tx.photos.map((p) => ({
        key: p.id,
        existing: { id: p.id, url: p.url, caption: p.caption },
        caption: p.caption ?? "",
      })),
    );
    setEntryCurrency(currency);
    setReceiptError(null);
    setCategoryError(null);
    setOpen(true);
  }

  /** فرم را برای «تحقق» یک سررسید تراکنش تکرارشونده باز می‌کند (بخش ۳.۲).
      یک تراکنش واقعی تازه ثبت می‌شود (نه ویرایش): مبلغ/دسته/توضیح از الگو
      پیش‌پر می‌شوند، ولی «تاریخ» عمداً روی امروز است نه سررسید — چون ممکن
      است پرداخت دیرتر انجام شده باشد و کاربر باید تاریخ/ساعت را خودش نهایی
      کند. repeat=none چون این رخداد یک تراکنش عادی است، نه تعهدی دوباره. */
  async function openForOccurrence(tx: Transaction, dueDate: string) {
    if (saving.current) return;
    setFullscreenOnMobile(false);
    generation.current += 1;
    saving.current = true;
    savedTransaction.current = null;
    setEditing(null);
    setOccurrence(null);
    setOccurrenceError(null);
    setActivity("checkOccurrence");
    const current = currentRequest();
    try {
      const transactions = await useCases.listTransactions.execute();
      if (!current()) return;
      const recurring = transactions.find(item => item.id === tx.id);
      const receiptScope = { familyId: tx.familyId, memberId: currentMemberId, recurringId: tx.id, dueDate };
      if (!recurring || occurrenceStatus(recurring, dueDate) !== "pending") {
        clearPendingOccurrence(receiptScope);
        return notify("این سررسید دیگر نیاز به ثبت ندارد؛ اطلاعات را بازخوانی کنید");
      }
      const pendingId = readPendingOccurrence(receiptScope);
      const stored = pendingId ? transactions.find(item => item.id === pendingId) : null;
      if (pendingId && !stored) {
        return notify("تراکنش قبلی این نوبت پیدا نشد؛ پیش از ثبت دوباره، هزینه‌ها را بررسی کنید");
      }
      const source = stored ?? recurringTemplate(recurring);
      savedTransaction.current = stored ?? null;
      setEditing(stored ?? null);
      setOccurrence({ recurringId: tx.id, dueDate, familyId: tx.familyId });
      writeForm({
      type: source.type,
      amount: formatExpressionValue(toDisplay(source.amount, currency)),
      categoryId: source.category,
      date: formatISO(today()),
      time: nowTime(),
      memberId: source.memberId,
      note: source.note ?? "",
      accountId: source.accountId ?? "",
      toAccountId: source.toAccountId ?? "",
      feeChoice: !stored && source.type === "expense" ? "" : source.transferFeeMethod ? "yes" : "",
      paymentMethod: stored?.paymentMethod ?? (stored?.transferFeeMethod && stored.type === "expense" ? "bank_transfer" : ""),
      feeMethod: !stored && source.type === "expense" ? "" : source.transferFeeMethod ?? "",
      label: subcategories.find((s) => s.id === source.subcategoryId)?.name ?? "",
      repeat: "none",
      repeatEnd: "",
      });
      if (stored) writeForm(previous => ({ ...previous, date: formatISO(isoToJalali(stored.date)), time: stored.time ?? "" }));
      setPhotos(stored?.photos.map(photo => ({ key: photo.id, existing: photo, caption: photo.caption ?? "" })) ?? []);
      setReceiptError(null);
      setCategoryError(null);
      setEntryCurrency(currency);
      setOpen(true);
    } catch {
      if (current()) notify("بررسی سررسید ممکن نشد؛ دوباره تلاش کنید");
    } finally {
      if (current()) { saving.current = false; setActivity(null); }
    }
  }

  function setType(type: "expense" | "income" | "transfer") {
    if (saving.current || serviceExpense || occurrence) return;
    setForm((f) => ({
      ...f,
      type,
      /* انتقال دسته ثابت دارد؛ هزینه/درآمد دوباره از گرید انتخاب می‌شوند */
      categoryId: type === "transfer" ? defaultCategoryOf("transfer").id : "",
      label: "" /* دسته عوض شد — لیبل قبلی نامعتبر می‌شود */,
    }));
  }


  /** تعویض ارز ورودی — مقدار تایپ‌شده (حتی عبارت ریاضی) به واحد جدید تبدیل می‌شود */
  function switchEntryCurrency(next: string) {
    if (saving.current || occurrencePending) return;
    if (!form.amount.trim()) { setEntryCurrency(next); return; }
    const v = parseScheduledAmount(form.amount, entryCurrency);
    if (v === null) return notify("مبلغ معتبر وارد کنید");
    setForm((f) => ({
      ...f,
      amount: formatExpressionValue(toDisplay(v, next)),
    }));
    setEntryCurrency(next);
  }

  async function save(onDone: () => Promise<void>, accountsCount: number, _confirmBalance = false) {
    if (saving.current || !open) return;
    const amount = parseScheduledAmount(form.amount, entryCurrency);
    if (amount === null) return notify("لطفاً مبلغ معتبر وارد کنید");
    const baseAmount = occurrencePending && editing ? editing.amount : amount;
    if (compareMoney(baseAmount, "0") <= 0) return notify("لطفاً مبلغ معتبر وارد کنید");
    const parsedDate = parse(form.date);
    if (!parsedDate) return notify("تاریخ تراکنش را انتخاب کنید");

    const isTransfer = form.type === "transfer";

    /* هزینه/درآمد بدون دسته مجاز نیست (گرید انتخاب دسته) */
    if (!isTransfer && !form.categoryId) {
      return notify("دسته‌بندی را انتخاب کنید");
    }

    /* حساب الزامی — با پیام دقیق. استثنا: تحقق سررسید تراکنش تکرارشونده
       (بخش ۳.۱ حساب را برای تعهد دوره‌ای اختیاری کرد؛ اینجا هم بن‌بست
       «خانواده بدون حساب» پیش نیاید) */
    if (!form.accountId && !occurrence && !serviceExpense) {
      if (!accountsCount) {
        return notify(
          "هنوز هیچ کارت/حسابی ثبت نشده — ابتدا از بخش «حساب‌ها» یک حساب اضافه کنید",
        );
      }
      return notify(
        isTransfer
          ? "حساب مبدأ را انتخاب کنید — انتقال از کدام حساب انجام شود؟"
          : form.type === "expense"
            ? "انتخاب حساب الزامی است — این هزینه از کدام حساب پرداخت شد؟"
            : "انتخاب حساب الزامی است — این درآمد به کدام حساب واریز شد؟",
      );
    }

    /* انتقال: مقصد الزامی و متفاوت از مبدأ */
    if (isTransfer) {
      if (!form.toAccountId) {
        return notify(
          "حساب مقصد را انتخاب کنید — پول به کدام حساب/کیف‌پول برود؟",
        );
      }
      if (form.toAccountId === form.accountId) {
        return notify("حساب مبدأ و مقصد نباید یکی باشد");
      }
    }

    /* تراکنش تکرارشونده حتماً تاریخ پایان معتبر دارد */
    const repeat = form.repeat;
    let repeatEndIso: string | null = null;
    if (repeat !== "none") {
      const parsedEnd = parse(form.repeatEnd);
      if (!parsedEnd) {
        return notify(
          "تاریخ پایان تکرار را انتخاب کنید — این تراکنش تا چه زمانی تکرار شود؟",
        );
      }
      const endIso = jalaliToIso(parsedEnd);
      if (endIso < jalaliToIso(parsedDate)) {
        return notify("تاریخ پایان تکرار نمی‌تواند قبل از تاریخ تراکنش باشد");
      }
      repeatEndIso = endIso;
    }

    // The ref locks synchronously, including the label request before React rerenders.
    saving.current = true;
    const checkingBalance = !occurrencePending && !!form.accountId;
    setActivity(occurrence ? "checkOccurrence" : checkingBalance ? "checkBalance" : "save");
    setReceiptError(null);
    const current = currentRequest();
    let original = savedTransaction.current;
    let recurringRevision = 0;
    let transactionSaved = false;
    let receiptsSaved = false;
    let occurrenceHandled = occurrence === null;
    let phase: "occurrence" | "balance" | "label" | "transaction" | "receipts" = occurrence ? "occurrence" : checkingBalance ? "balance" : "label";
    let transferFeeMethod: TransferFeeMethod | null = null;
    let transferFeeRial = "0";
    try {
      if (occurrence) {
        const transactions = await useCases.listTransactions.execute();
        if (!current()) return;
        const recurring = transactions.find(item => item.id === occurrence.recurringId);
        recurringRevision = recurring?.recurringPlan?.revision ?? 0;
        const status = recurring ? occurrenceStatus(recurring, occurrence.dueDate) : "invalid";
        if (!original) {
          original = transactions.find(item => item.recurringSourceId === occurrence.recurringId
            && item.recurringDueDate === occurrence.dueDate) ?? null;
          if (original) { savedTransaction.current = original; setEditing(original); }
        }
        if (status !== "pending" && !original) return notify("این سررسید دیگر نیاز به ثبت ندارد؛ اطلاعات را بازخوانی کنید");
        if (original && !transactions.some(item => item.id === original?.id)) return notify("تراکنش قبلی این نوبت پیدا نشد؛ هزینه‌ها را بررسی کنید");
        if (status === "invalid" && original) return notify("تکرار متوقف یا تغییر کرده است؛ تراکنش ثبت‌شده در هزینه‌ها باقی می‌ماند");
        occurrenceHandled = status === "handled";
      }
      if (checkingBalance) {
        phase = "balance";
        const [accounts, transactions, transferTargets] = await Promise.all([
          useCases.listAccounts.execute(),
          useCases.listTransactions.execute(),
          isTransfer ? useCases.listAccounts.transferTargets() : Promise.resolve([]),
        ]);
        if (!current()) return;
        const account = accounts.find(item => item.id === form.accountId);
        if (!account) {
          notify("حساب انتخاب‌شده در دسترس نیست؛ حساب دیگری انتخاب کنید");
          return;
        }
        const ownerId = original && !occurrence ? original.memberId : currentMemberId;
        if (account.memberId !== ownerId) {
          notify("فقط حساب‌های خودتان قابل انتخاب‌اند");
          return;
        }
        const destination = accounts.find(item => item.id === form.toAccountId)
          ?? transferTargets.find(item => item.id === form.toAccountId && item.familyId === account.familyId);
        if (isTransfer) {
          if (!destination) return notify("حساب مقصد در دسترس نیست؛ حساب دیگری انتخاب کنید.");
          if (account.kind === "bank" && destination.kind === "bank") {
            if (!form.feeChoice) return notify("مشخص کنید این انتقال کارمزد داشته است یا خیر.");
          }
        }
        if (form.type === "expense" && account.kind === "bank" && !form.paymentMethod)
          return notify("روش پرداخت هزینه را انتخاب کنید: کارت، پرداخت آنلاین یا انتقال بانکی.");
        const bankFeePayment = account.kind === "bank" && (form.type === "expense"
          || (isTransfer && destination?.kind === "bank"));
        if (bankFeePayment && (form.type === "expense" ? form.paymentMethod === "bank_transfer" : form.feeChoice === "yes")) {
          if (!form.feeMethod) return notify("نوع انتقال را انتخاب کنید.");
          transferFeeMethod = form.feeMethod;
           const rial = convertMoney(baseAmount, "ریال");
           if (!moneyFits(rial, { scale: 0, min: "1", max: "9999999999990" })) return notify("مبلغ پرداخت باید عدد صحیح مثبت به ریال باشد.");
          transferFeeRial = await useCases.quoteTransferFee.execute(transferFeeMethod, rial);
          if (!current()) return;
        }
        if (form.type === "income") {
          setBalanceWarning(null);
        } else {
        const authoritative = await useCases.walletCorrections.balance({ familyId: account.familyId, memberId: currentMemberId, accountId: account.id });
        if (!current()) return;
        const warning = expenseBalanceWarning(account, transactions, addMoney(baseAmount, multiplyMoney(transferFeeRial, "0.1")), original?.id, authoritative.currentBalance);
        if (warning) {
          reviewedBalance.current = null;
          writeForm(previous => ({ ...previous, accountId: "" }));
          notify("موجودی این حساب برای مبلغ واردشده کافی نیست؛ حساب دیگری انتخاب کنید");
          return;
        }
        reviewedBalance.current = warning;
        setBalanceWarning(null);
        }
      }
      setActivity("save");
      phase = "label";
      let subcategoryId: string | null = null;
      const label = form.label.trim();
      if (!occurrencePending && !isTransfer && label) {
        const sub = await useCases.addSubcategory.execute(form.categoryId, label);
        if (!current()) return;
        subcategoryId = sub.id;
      }
      const input = {
        transferFeeMethod,
        paymentMethod: form.type === "expense" ? form.paymentMethod || null : null,
        requireAvailableBalance: true,
        memberId: form.memberId || currentMemberId,
        type: form.type,
        amount: baseAmount,
        category: isTransfer ? "transfer" : form.categoryId,
        date: jalaliToIso(parsedDate),
        time: form.time || null,
        note: form.note.trim() || null,
        accountId: form.accountId || null,
        toAccountId: isTransfer ? form.toAccountId : null,
        subcategoryId: isTransfer ? null : subcategoryId,
        repeat,
        repeatEnd: repeatEndIso,
      };

      phase = "transaction";
      let stored: Transaction;
      if (original && occurrence) {
        stored = original;
      } else if (original) {
        await useCases.updateTransaction.execute(original.id, input);
        if (!current()) return;
        stored = { ...original, ...input };
      } else if (occurrence) {
        stored = await useCases.settleOccurrence.execute(occurrence.recurringId, {
          dueDate: occurrence.dueDate, revision: recurringRevision, accountId: input.accountId,
          toAccountId: input.toAccountId, transaction: input,
        });
        if (!current()) return;
        occurrenceHandled = true;
      } else {
        stored = await useCases.addTransaction.execute(input);
        if (!current()) return;
      }
      savedTransaction.current = stored;
      setEditing(stored);
      transactionSaved = true;

      // Preserve the successful financial identity before acknowledging its due date.
      if (occurrence) {
        const receiptScope = { ...occurrence, memberId: currentMemberId };
        const remembered = rememberPendingOccurrence(receiptScope, stored.id);
        try {
          if (!occurrenceHandled) await useCases.markRecurringOccurrence.execute(
            occurrence.recurringId,
            occurrence.dueDate,
          );
          if (!current()) return;
          occurrenceHandled = true;
          clearPendingOccurrence(receiptScope);
          setOccurrence(previous => previous ? { ...previous, acknowledged: true } : null);
          setOccurrenceError(null);
        } catch {
          if (!current()) return;
          setOccurrenceError(remembered
            ? "تراکنش ثبت شد؛ تأیید سررسید ناموفق بود. دوباره تأیید کنید"
            : "تراکنش ثبت شد؛ این فرم را باز نگه دارید و سررسید را دوباره تأیید کنید");
        }
      }
      if (!current()) return;

      /* تصاویر: کپن‌های ویرایش‌شده + صف آپلود */
      phase = "receipts";
      if (stored.id) {
        for (const p of photos) {
          if (p.existing && p.caption.trim() !== (p.existing.caption ?? "")) {
            await useCases.updateTxPhotoCaption.execute(
              p.existing.id,
              p.caption.trim() || null,
            );
            if (!current()) return;
            setPhotos((items) => items.map((item) => item.key === p.key
              ? { ...item, existing: { ...p.existing!, caption: p.caption.trim() || null } } : item));
          }
        }
        for (const p of photos) {
          if (!p.existing && p.dataUrl) {
            const url = p.uploadedUrl ?? await useCases.uploadTxPhoto.execute(p.dataUrl);
            if (!current()) return;
            setPhotos((items) => items.map((item) => item.key === p.key ? { ...item, uploadedUrl: url } : item));
            const attached = await useCases.addTxPhoto.execute(
              stored.id,
              url,
              p.caption.trim() || null,
            );
            if (!current()) return;
            setPhotos((items) => items.map((item) => item.key === p.key
              ? { key: item.key, caption: item.caption, existing: attached } : item));
          }
        }
      }

      receiptsSaved = true;
    } catch (e) {
      if (!current()) return;
      if (phase === "occurrence") {
        notify("بررسی سررسید ممکن نشد؛ دوباره تلاش کنید");
        return;
      }
      if (phase === "balance") {
        notify("بررسی موجودی حساب ممکن نشد؛ دوباره تلاش کنید");
        return;
      }
      const message = (e as Error).message || "خطا در ذخیره";
      if (transactionSaved) {
        setReceiptError(message);
        notify("تراکنش ذخیره شد، اما بعضی رسیدها ذخیره نشدند؛ دوباره تلاش کنید");
      } else {
        notify((e as Error).message || (phase === "label" ? "خطا در ثبت لیبل" : "خطا در ذخیره"));
      }
    } finally {
      if (transactionSaved && current()) {
        let refreshed = true;
        try { await onDone(); }
        catch {
          refreshed = false;
          if (current()) notify("تراکنش ذخیره شد، اما اطلاعات صفحه تازه نشد؛ صفحه را بازخوانی کنید");
        }
        if (current() && receiptsSaved && occurrenceHandled) {
          setOccurrence(null);
          setOpen(false);
          if (refreshed) notify(occurrence ? "سررسید تأیید شد" : original ? "تراکنش ویرایش شد" : "تراکنش ثبت شد");
        }
      }
      if (current()) { saving.current = false; setActivity(null); }
    }
  }

  async function remove(onDone: () => Promise<void>) {
    if (saving.current || !editing) return;
    if (!confirm("این تراکنش حذف شود؟")) return;
    saving.current = true; setActivity("delete");
    const current = currentRequest();
    try {
      await useCases.deleteTransaction.execute(editing.id);
      if (!current()) return;
      notify("تراکنش حذف شد");
      setOpen(false);
      await onDone();
    } catch (e) {
      if (current()) notify((e as Error).message || "خطا در حذف");
    } finally {
      if (current()) { saving.current = false; setActivity(null); }
    }
  }

  /* همگام‌سازی عضو پیش‌فرض وقتی لیست اعضا آماده شد */
  useEffect(() => {
    if (open && !members.find((m) => m.id === form.memberId)) {
      setForm((f) => ({ ...f, memberId: currentMemberId }));
    }
  }, [members, open, form.memberId, currentMemberId]);

  async function addCategory(name: string, after: () => void | Promise<void>): Promise<boolean> {
    if (!open || saving.current || form.type === "transfer" || serviceExpense) return false;
    const trimmed = name.trim();
    if (!trimmed) { setCategoryError("نام دسته را وارد کنید"); return false; }
    if (trimmed.length > 30) { setCategoryError("نام دسته حداکثر ۳۰ کاراکتر است"); return false; }
    saving.current = true;
    setActivity("saveCategory");
    setCategoryError(null);
    const current = currentRequest();
    let created = false;
    try {
      const category = await useCases.addCustomCategory.execute(form.type, trimmed);
      created = true;
      if (!current()) return false;
      await after();
      if (!current()) return false;
      writeForm(previous => ({ ...previous, categoryId: category.id, label: "" }));
      notify("دسته اضافه شد");
      return true;
    } catch (error) {
      if (current()) setCategoryError(created
        ? "دسته ساخته شد؛ اطلاعات صفحه تازه نشد. دوباره تلاش کنید"
        : (error as Error).message || "خطا در افزودن دسته");
      return false;
    } finally {
      if (current()) { saving.current = false; setActivity(null); }
    }
  }

  return {
    open,
    fullscreenOnMobile,
    editing,
    serviceExpense,
    recurringOccurrence: occurrence !== null,
    occurrencePending,
    occurrenceAcknowledged: occurrence?.acknowledged === true,
    occurrenceError,
    form,
    setForm,
    photos,
    busy,
    activity,
    receiptError,
    categoryError,
    addCategory,
    clearCategoryError: () => { if (!saving.current) setCategoryError(null); },
    balanceWarning,
    dismissBalanceWarning: () => {
      if (saving.current) return;
      reviewedBalance.current = null;
      setBalanceWarning(null);
    },
    openNew: () => openNew(),
    openQuickAdd: () => openNew({ fullscreenOnMobile: true }),
    openEdit,
    openForOccurrence,
    setType,
    save,
    remove,
    close: () => { if (!saving.current) { generation.current += 1; setOpen(false); } },
    setAmount: (v: string) =>
      /* نویسهٔ نامعتبر حفظ می‌شود تا اعتبارسنجی آن را رد کند؛ حذفش مبلغ را تغییر می‌دهد. */
      setForm((f) => ({
        ...f,
        amount: normalizeExpressionInput(v),
      })),
    setDate: (v: string) =>
      !serviceExpense && setForm((f) => ({ ...f, date: liveFormatJalaliDate(v) })),
    setTime: (v: string) => setForm((f) => ({ ...f, time: v })),
    setRepeat: (v: TxRepeat) => !serviceExpense && !occurrence && setForm((f) => ({ ...f, repeat: v })),
    setRepeatEnd: (v: string) =>
      setForm((f) => ({ ...f, repeatEnd: liveFormatJalaliDate(v) })),
    /* ارز ورودی مبلغ */
    entryCurrency,
    switchEntryCurrency,
    /* انتخاب فایل‌های تصویر → فشرده‌سازی و افزودن به صف آپلود */
    addPhotoFiles: async (files: File[]) => {
      if (saving.current) return;
      if (serviceExpense) return notify("رسید سرویس خودرو را در اسناد خانه ثبت و به خودرو وصل کنید.");
      const room = MAX_PHOTOS - photos.length;
      if (room <= 0) {
        return notify(`حداکثر ${MAX_PHOTOS} تصویر برای هر تراکنش`);
      }
      saving.current = true; setActivity("preparePhotos");
      const current = currentRequest();
      const items: TxPhotoItem[] = [];
      try {
        for (const file of files.slice(0, room)) {
          try {
            /* رسید/عکس محصول — ۱۰۲۴px برای خوانایی متن رسید */
            const dataUrl = await compressImage(file, 1024, 0.85);
            if (!current()) return;
            items.push({
              key: Math.random().toString(36).slice(2),
              dataUrl,
              caption: "",
            });
          } catch {
            /* فایل خراب — رد می‌شود */
          }
        }
        if (items.length && current()) setPhotos((ps) => [...ps, ...items]);
      } finally {
        if (current()) { saving.current = false; setActivity(null); }
      }
    },
    setPhotoCaption: (key: string, v: string) =>
      !saving.current && setPhotos((ps) =>
        ps.map((p) => (p.key === key ? { ...p, caption: v.slice(0, 100) } : p)),
      ),
    /* حذف: عکس موجود فوراً از سرور؛ عکس صف فقط از لیست */
    removePhoto: async (key: string) => {
      if (saving.current) return;
      const item = photos.find((p) => p.key === key);
      if (!item) return;
      if (item.existing) {
        if (!confirm("این تصویر حذف شود؟")) return;
        saving.current = true; setActivity("removePhoto");
        const current = currentRequest();
        try {
          await useCases.deleteTxPhoto.execute(item.existing.id);
          if (!current()) return;
          setPhotos((ps) => ps.filter((p) => p.key !== key));
        } catch (e) {
          if (current()) notify((e as Error).message || "خطا در حذف تصویر");
        } finally {
          if (current()) { saving.current = false; setActivity(null); }
        }
        return;
      }
      setPhotos((ps) => ps.filter((p) => p.key !== key));
    },
  };
}

export type TxFormModel = ReturnType<typeof useTxFormModel>;
