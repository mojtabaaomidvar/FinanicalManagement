/* Atomic server recording; browser receipts only recover successful legacy writes. */
import { useEffect, useRef, useState } from "react";
import type { BankSms } from "@/domain/sms/sms.types";
import type { PaymentMethod, Transaction, TransferFeeMethod } from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import { smsDraftDefaults } from "@/domain/sms/sms.rules";
import { formatAmount, liveFormatJalaliDate } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { addMoney, convertMoney, moneyFits, multiplyMoney } from "@/shared/lib/money";
import { parseScheduledAmount } from "@/domain/transaction/recurring.rules";
import { toEn } from "@/shared/lib/digits";
import { parse, formatISO, jalaliToIso, isoToJalali } from "@/shared/lib/jalali";
import { categoriesFor } from "@/domain/category/category.catalog";
import { formatExpressionValue } from "@/shared/ui";
import { expenseBalanceWarning } from "@/features/transaction-form/model/expenseBalance";
import { clearSmsReceipt, readSmsReceipt } from "./pendingSmsReceipt";
import { readPendingDraft, rememberPendingDraft, clearPendingDraft, type PendingSmsDraft } from "./smsDraftStorage";

export function usePendingSmsModel(
  useCases: UseCases,
  currentMemberId: string,
  notify: (m: string) => void,
  currency: string = "تومان",
  enabled = true,
) {
  const [list, setList] = useState<BankSms[]>([]);
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [amountNeedsReview, setAmountNeedsReview] = useState(false);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState("food");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [memberId, setMemberId] = useState(currentMemberId);
  const [accountId, setAccountId] = useState("");
  const [feeChoice, setFeeChoice] = useState<"" | "yes" | "no">("");
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>("");
  const [feeMethod, setFeeMethod] = useState<"" | TransferFeeMethod>("");
  const [label, setLabel] = useState("");
  const operation = useRef(false);
  const saved = useRef<string | null>(null);
  const generation = useRef(0);
  const identity = useRef({ useCases, currentMemberId, enabled });
  if (identity.current.useCases !== useCases || identity.current.currentMemberId !== currentMemberId || identity.current.enabled !== enabled) {
    identity.current = { useCases, currentMemberId, enabled };
  }
  const readTurn = useRef(0);
  const reviewTarget = useRef<string | true | null>(null);
  const entryCurrency = useRef(currency);
  const knownTransactions = useRef<Transaction[]>([]);

  useEffect(() => {
    generation.current++; readTurn.current++; operation.current = false;
    saved.current = null; knownTransactions.current = []; reviewTarget.current = null;
    setOpen(false); setList([]); setSavedId(null); setBusy(false); setLoading(false);
    setError(null); setLoadError(null); setAmountNeedsReview(false);
    return () => { generation.current++; readTurn.current++; };
  }, [useCases, currentMemberId, enabled]);

  function hydrate(sms: BankSms) {
    const d = smsDraftDefaults(sms, currentMemberId);
    const transactionId = readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
    const original = knownTransactions.current.find(tx => tx.id === transactionId && tx.familyId === sms.familyId && tx.memberId === currentMemberId);
    const draft = original ? null : readPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
    saved.current = transactionId;
    setSavedId(transactionId);
    entryCurrency.current = currency;
    const draftType = draft?.type ?? d.type;
    setType(original?.type === "income" ? "income" : original ? "expense" : draftType);
    setCategoryId(original?.category ?? draft?.categoryId ?? d.categoryId);
    const baseAmount = original?.amount ?? parseScheduledAmount(d.amount, "تومان");
    const draftAmount = draft ? parseScheduledAmount(draft.amount, draft.currency) : null;
    setAmount(draft ? draftAmount !== null
      ? formatExpressionValue(toDisplay(draftAmount, currency)) : draft.amount
      : baseAmount ? formatExpressionValue(toDisplay(baseAmount, currency)) : "");
    setAmountNeedsReview(d.amountNeedsReview);
    setDate(original ? formatISO(isoToJalali(original.date)) : draft?.date ?? (d.jalaliDate ? formatISO(d.jalaliDate) : ""));
    setTime(original?.time ?? draft?.time ?? d.time ?? "");
    setNote(original?.note ?? draft?.note ?? "");
    setMemberId(currentMemberId);
    setAccountId(original?.accountId ?? draft?.accountId ?? sms.accountId ?? "");
    setFeeChoice(original?.transferFeeMethod ? "yes" : draft?.feeChoice ?? "");
    setFeeMethod(original?.transferFeeMethod ?? draft?.feeMethod ?? "");
    setPaymentMethod(original?.paymentMethod ?? draft?.paymentMethod ?? (original?.transferFeeMethod || draft?.feeChoice === "yes" ? "bank_transfer" : ""));
    setLabel(draft?.label ?? "");
    setError(null);
  }

  async function load(options: { review?: boolean; smsId?: string } = {}) {
    if (!enabled || operation.current) return;
    if (options.review) reviewTarget.current = options.smsId ?? reviewTarget.current ?? true;
    const mine = ++readTurn.current;
    const currentGeneration = generation.current;
    const currentIdentity = identity.current;
    const current = () => currentGeneration === generation.current && currentIdentity === identity.current;
    setLoading(true);
    setLoadError(null);
    try {
      const pending = (await useCases.listPendingSms.execute()).filter(sms => !sms.memberId || sms.memberId === currentMemberId);
      const hasReceipts = pending.some(sms => readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id }));
      const transactions = hasReceipts ? await useCases.listTransactions.execute() : [];
      if (mine !== readTurn.current || !current()) return;
      setList(pending);
      knownTransactions.current = transactions;
      const selectedId = typeof reviewTarget.current === "string" ? reviewTarget.current : undefined;
      const selected = selectedId ? pending.findIndex(sms => sms.id === selectedId) : 0;
      setIdx(Math.max(0, selected));
      if (pending.length && reviewTarget.current !== null) {
        if (selected < 0) { reviewTarget.current = null; setOpen(false); notify("این پیامک دیگر در انتظار ثبت نیست؛ فهرست تازه شد."); }
        else { reviewTarget.current = pending[selected].id; hydrate(pending[selected]); setOpen(true); }
      } else if (!pending.length) { reviewTarget.current = null; setOpen(false); }
    } catch (e) {
      if (mine !== readTurn.current || !current()) return;
      setLoadError(e instanceof Error ? e.message : "خطا در دریافت پیامک‌ها");
      if (reviewTarget.current !== null) setOpen(true);
    } finally {
      if (mine === readTurn.current && current()) setLoading(false);
    }
  }

  function close() {
    if (operation.current) return;
    readTurn.current++;
    reviewTarget.current = null;
    setLoading(false);
    setOpen(false);
  }

  function advance() {
    const nextList = list.filter((_, index) => index !== idx);
    setList(nextList);
    const next = Math.min(idx, nextList.length - 1);
    if (next < 0) {
      reviewTarget.current = null;
      setOpen(false); saved.current = null; setSavedId(null); setError(null);
      notify("همه پیامک‌ها رسیدگی شدند");
    } else { reviewTarget.current = nextList[next].id; setIdx(next); hydrate(nextList[next]); }
  }

  async function record(onDone: () => Promise<void>, accountsCount: number) {
    const sms = list[idx];
    if (!enabled || !sms || operation.current || loading || loadError) return;
    const originalId = saved.current;
    const amt = parseScheduledAmount(amount, entryCurrency.current);
    const parsedDate = parse(date);
    if (!originalId) {
      if (amt === null) {
        return setError("لطفاً مبلغ معتبر وارد کنید");
      }
      if (!accountId) return setError(accountsCount
        ? "انتخاب حساب الزامی است"
        : "هنوز حسابی ثبت نشده؛ ابتدا از بخش حساب‌ها یک حساب اضافه کنید");
      if (!parsedDate) return setError("تاریخ معتبر انتخاب کنید");
      if (time && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) return setError("ساعت معتبر با قالب ساعت و دقیقه وارد کنید؛ ثانیه اختیاری است.");
    }
    operation.current = true;
    readTurn.current++;
    setBusy(true);
    setError(null);
    const currentGeneration = generation.current;
    const currentIdentity = identity.current;
    const current = () => currentGeneration === generation.current && currentIdentity === identity.current;
    const scope = { familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id };
    let acknowledged = false;
    let refreshedAccounts = false;
    try {
      const [pending, accounts, transactions] = await Promise.all([
        useCases.listPendingSms.execute(), useCases.listAccounts.execute(), useCases.listTransactions.execute(),
      ]);
      if (!current()) return;
      refreshedAccounts = true;
      knownTransactions.current = transactions;
      if (originalId && !transactions.some(tx => tx.id === originalId && tx.familyId === sms.familyId && tx.memberId === currentMemberId)) {
        return setError("تراکنش قبلی پیدا نشد؛ فهرست تراکنش‌ها را بررسی کنید");
      }
      if (!pending.some(item => item.id === sms.id)) {
        // Another device or an earlier response may already have completed the
        // atomic write. Ask the server for its receipt; never create a second tx.
        await useCases.recordSms.execute(sms, {
          memberId: currentMemberId, type, amount: amt ?? "0", category: categoryId,
          date: parsedDate ? jalaliToIso(parsedDate) : sms.date!, time: time || null, note, accountId,
        }, { transactionId: originalId ?? undefined, isCurrent: current });
        if (!current()) return;
        clearSmsReceipt(scope); clearPendingDraft(scope); advance(); acknowledged = true;
        return;
      }
      const account = accounts.find(item => item.id === accountId);
      if (!originalId && (!account || account.memberId !== currentMemberId || account.familyId !== sms.familyId)) {
        setAccountId(""); return setError("فقط حساب‌ها و کیف‌پول‌های خودتان قابل انتخاب‌اند.");
      }
      const currentSms = pending.find(item => item.id === sms.id);
      if (currentSms?.memberId && currentSms.memberId !== currentMemberId) return setError("این پیامک متعلق به شما نیست.");
      const baseAmount = amt ?? "0";
      let transferFeeMethod: TransferFeeMethod | null = null;
      let transferFeeRial = "0";
      if (!originalId && type === "expense" && account?.kind === "bank") {
        if (!paymentMethod) return setError("روش پرداخت هزینه را انتخاب کنید: کارت، پرداخت آنلاین یا انتقال بانکی.");
        if (paymentMethod === "bank_transfer") {
          if (!feeMethod) return setError("نوع انتقال را انتخاب کنید.");
          const rial = convertMoney(baseAmount, "ریال");
          if (!moneyFits(rial, { scale: 0, min: "1", max: "9999999999990" })) return setError("مبلغ پرداخت باید عدد صحیح مثبت به ریال باشد.");
          transferFeeMethod = feeMethod;
          transferFeeRial = await useCases.quoteTransferFee.execute(feeMethod, rial);
          if (!current()) return;
        }
      }
      if (!originalId && type === "expense" && account) {
        const authoritative = await useCases.walletCorrections.balance({ familyId: account.familyId, memberId: currentMemberId, accountId: account.id });
        if (!current()) return;
        if (expenseBalanceWarning(account, transactions, addMoney(baseAmount, multiplyMoney(transferFeeRial, "0.1")), undefined, authoritative.currentBalance)) {
          setAccountId("");
          return setError("موجودی این حساب برای مبلغ واردشده کافی نیست؛ حساب دیگری انتخاب کنید.");
        }
      }
      const sub = !originalId && label.trim() ? await useCases.addSubcategory.execute(categoryId, label.trim()) : null;
      if (!current()) return;
      await useCases.recordSms.execute(sms, {
        transferFeeMethod, requireAvailableBalance: true, memberId: currentMemberId, type, amount: baseAmount, category: categoryId,
        paymentMethod: type === "expense" && account?.kind === "bank" ? paymentMethod || null : null,
        date: parsedDate ? jalaliToIso(parsedDate) : sms.date!, time: time || null, note, accountId, subcategoryId: sub?.id ?? null,
      }, {
        transactionId: originalId ?? undefined,
        isCurrent: current,
      });
      if (!current()) return;
      acknowledged = true;
      clearSmsReceipt(scope);
      clearPendingDraft(scope);
      if (current()) advance();
    } catch (e) {
      if (current()) setError(saved.current
        ? "تراکنش قبلی ثبت شده است؛ بازیابی پیوند پیامک ناموفق بود. سابقه را بررسی و دوباره تلاش کنید."
        : e instanceof Error ? e.message : "خطا در ثبت پیامک");
    } finally {
      if (current() && (saved.current || acknowledged || refreshedAccounts)) {
        try { await onDone(); }
        catch { if (current()) notify(saved.current || acknowledged
          ? "تراکنش ثبت شد؛ دریافت اطلاعات تازه ناموفق بود"
          : "دریافت موجودی تازه ناموفق بود؛ دوباره تلاش کنید."); }
      }
      if (current()) { operation.current = false; setBusy(false); }
    }
  }

  async function ignore() {
    const sms = list[idx];
    if (!enabled || !sms || operation.current || saved.current || loading || loadError) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    const currentGeneration = generation.current;
    const currentIdentity = identity.current;
    const current = () => currentGeneration === generation.current && currentIdentity === identity.current;
    try {
      await useCases.ignoreSms.execute(sms.id);
      if (current()) {
        clearPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
        advance();
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "خطا در نادیده‌گرفتن پیامک");
    } finally {
      if (current()) { operation.current = false; setBusy(false); }
    }
  }

  function edit(patch: Partial<PendingSmsDraft>) {
    if (operation.current || saved.current) return;
    const next: PendingSmsDraft = { type, categoryId, amount, currency: entryCurrency.current, date, time, note, accountId, label, feeChoice, feeMethod, paymentMethod, ...patch };
    if (next.accountId !== accountId || next.type !== type) { next.feeChoice = ""; next.feeMethod = ""; next.paymentMethod = ""; }
    const sms = list[idx];
    if (sms && !rememberPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id }, next))
      notify("پیش‌نویس بررسی پیامک در این مرورگر ذخیره نشد؛ پیش از بستن فرم آن را ثبت کنید.");
    setType(next.type); setCategoryId(next.categoryId); setAmount(next.amount);
    setDate(next.date); setAccountId(next.accountId); setLabel(next.label); setError(null);
    setTime(next.time ?? ""); setNote(next.note ?? "");
    setFeeChoice(next.feeChoice ?? ""); setFeeMethod(next.feeMethod ?? "");
    setPaymentMethod(next.paymentMethod ?? "");
  }
  return {
    list, idx, open, busy, loading, loadError, error, savedId, amountNeedsReview,
    type, categoryId, amount, date, time, note, memberId, accountId, label, feeChoice, feeMethod, paymentMethod, entryCurrency: entryCurrency.current,
    setPaymentMethod: (v: PaymentMethod) => edit({ paymentMethod: v, feeMethod: v === "bank_transfer" ? feeMethod : "" }),
    setTime: (v: string) => edit({ time: toEn(v) }),
    setNote: (v: string) => edit({ note: v }),
    setCategoryId: (v: string) => edit({ categoryId: v, label: "" }),
    setAmount: (v: string) => {
      const numeric = toEn(v).replace(/[٬،,\s]/g, "");
      edit({ amount: /^\d+$/.test(numeric) && numeric.length <= 128 ? formatAmount(numeric) : v });
    },
    setAccountId: (v: string) => edit({ accountId: v }),
    setFeeChoice: (v: "yes" | "no") => edit({ feeChoice: v, feeMethod: v === "no" ? "" : feeMethod }),
    setFeeMethod: (v: TransferFeeMethod | "") => edit({ feeMethod: v }),
    setLabel: (v: string) => edit({ label: v }),
    changeType: (t: "expense" | "income") => edit({ type: t, categoryId: categoriesFor(t)[0].id, label: "" }),
    setDate: (v: string) => edit({ date: liveFormatJalaliDate(v) }),
    load, close, record, ignore, raw: list[idx]?.rawText ?? "",
  };
}
