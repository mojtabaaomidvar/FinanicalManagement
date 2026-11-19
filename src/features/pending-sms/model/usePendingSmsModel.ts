/* Review pending bank messages; retain successful writes before acknowledgement. */
import { useEffect, useRef, useState } from "react";
import type { BankSms } from "@/domain/sms/sms.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { UseCases } from "@/application/useCases";
import { smsDraftDefaults, smsSummary } from "@/domain/sms/sms.rules";
import { formatAmount, liveFormatJalaliDate } from "@/shared/lib/format";
import { fromDisplay, toDisplay } from "@/shared/lib/currency";
import { toEn } from "@/shared/lib/digits";
import { parse, formatISO, jalaliToIso, isoToJalali } from "@/shared/lib/jalali";
import { categoriesFor } from "@/domain/category/category.catalog";
import { expenseBalanceWarning, sameExpenseBalance, type ExpenseBalanceWarning } from "@/features/transaction-form/model/expenseBalance";
import { clearSmsReceipt, readSmsReceipt, rememberSmsReceipt } from "./pendingSmsReceipt";

export function usePendingSmsModel(
  useCases: UseCases,
  currentMemberId: string,
  notify: (m: string) => void,
  currency: string = "تومان",
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
  const [balanceWarning, setBalanceWarning] = useState<ExpenseBalanceWarning | null>(null);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [categoryId, setCategoryId] = useState("food");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [memberId, setMemberId] = useState(currentMemberId);
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const operation = useRef(false);
  const saved = useRef<string | null>(null);
  const persisted = useRef(true);
  const generation = useRef(0);
  const readTurn = useRef(0);
  const entryCurrency = useRef(currency);
  const knownTransactions = useRef<Transaction[]>([]);

  useEffect(() => {
    generation.current++; readTurn.current++; operation.current = false;
    saved.current = null; knownTransactions.current = [];
    setOpen(false); setList([]); setSavedId(null); setBusy(false); setLoading(false);
    return () => { generation.current++; readTurn.current++; };
  }, [useCases, currentMemberId]);

  function hydrate(sms: BankSms) {
    const d = smsDraftDefaults(sms, currentMemberId);
    const transactionId = readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
    const original = knownTransactions.current.find(tx => tx.id === transactionId && tx.familyId === sms.familyId);
    saved.current = transactionId;
    setSavedId(transactionId);
    persisted.current = true;
    entryCurrency.current = currency;
    setType(original?.type === "income" ? "income" : original ? "expense" : d.type);
    setCategoryId(original?.category ?? d.categoryId);
    const baseAmount = original?.amount ?? d.amount;
    setAmount(baseAmount ? formatAmount(toDisplay(baseAmount, currency)) : "");
    setAmountNeedsReview(d.amountNeedsReview);
    setDate(formatISO(original ? isoToJalali(original.date) : d.jalaliDate));
    setMemberId(original?.memberId ?? d.memberId);
    setAccountId(original?.accountId ?? sms.accountId ?? "");
    setLabel("");
    setError(null);
    setBalanceWarning(null);
  }

  async function load() {
    if (operation.current) return;
    const mine = ++readTurn.current;
    const currentGeneration = generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const pending = await useCases.listPendingSms.execute();
      const hasReceipts = pending.some(sms => readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id }));
      const transactions = hasReceipts ? await useCases.listTransactions.execute() : [];
      if (mine !== readTurn.current || currentGeneration !== generation.current) return;
      setList(pending);
      knownTransactions.current = transactions;
      setIdx(0);
      if (pending.length) { hydrate(pending[0]); setOpen(true); }
      else setOpen(false);
    } catch (e) {
      if (mine !== readTurn.current || currentGeneration !== generation.current) return;
      setLoadError(e instanceof Error ? e.message : "خطا در دریافت پیامک‌ها");
      setOpen(true);
    } finally {
      if (mine === readTurn.current && currentGeneration === generation.current) setLoading(false);
    }
  }

  function close() {
    if (operation.current) return;
    if (saved.current && !persisted.current) {
      notify("تراکنش ثبت شده است؛ ابتدا تأیید پیامک را کامل کنید");
      return;
    }
    readTurn.current++;
    setOpen(false);
    setBalanceWarning(null);
  }

  function advance() {
    const next = idx + 1;
    if (next >= list.length) {
      setOpen(false);
      setList([]);
      saved.current = null;
      setSavedId(null);
      setError(null);
      setBalanceWarning(null);
      notify("همه پیامک‌ها رسیدگی شدند");
    } else { setIdx(next); hydrate(list[next]); }
  }

  async function record(onDone: () => Promise<void>, accountsCount: number, confirmBalance = false) {
    const sms = list[idx];
    if (!sms || operation.current || loading || loadError) return;
    const originalId = saved.current;
    const numeric = toEn(amount).replace(/[٬،,\s]/g, "");
    const amt = Number(numeric);
    const parsedDate = parse(date);
    if (!originalId) {
      if (!/^\d+(?:\.\d+)?$/.test(numeric) || !Number.isFinite(amt) || amt <= 0 || fromDisplay(amt, entryCurrency.current) <= 0) {
        return setError("لطفاً مبلغ معتبر وارد کنید");
      }
      if (!accountId) return setError(accountsCount
        ? "انتخاب حساب الزامی است"
        : "هنوز حسابی ثبت نشده؛ ابتدا از بخش حساب‌ها یک حساب اضافه کنید");
      if (!parsedDate) return setError("تاریخ معتبر انتخاب کنید");
    }
    operation.current = true;
    readTurn.current++;
    setBusy(true);
    setError(null);
    const currentGeneration = generation.current;
    const current = () => currentGeneration === generation.current;
    const scope = { familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id };
    let acknowledged = false;
    try {
      const [pending, accounts, transactions] = await Promise.all([
        useCases.listPendingSms.execute(), useCases.listAccounts.execute(), useCases.listTransactions.execute(),
      ]);
      if (!current()) return;
      knownTransactions.current = transactions;
      if (originalId && !transactions.some(tx => tx.id === originalId && tx.familyId === sms.familyId)) {
        return setError("تراکنش قبلی پیدا نشد؛ فهرست تراکنش‌ها را بررسی کنید");
      }
      if (!pending.some(item => item.id === sms.id)) {
        if (originalId) { clearSmsReceipt(scope); advance(); acknowledged = true; }
        else setError("این پیامک دیگر در انتظار ثبت نیست؛ فهرست را دوباره دریافت کنید");
        return;
      }
      const account = accounts.find(item => item.id === accountId);
      if (!originalId && !account) return setError("حساب انتخاب‌شده در دسترس نیست؛ حساب دیگری انتخاب کنید");
      const baseAmount = fromDisplay(amt, entryCurrency.current);
      if (!originalId && type === "expense" && account) {
        const warning = expenseBalanceWarning(account, transactions, baseAmount);
        if (warning && (!confirmBalance || !sameExpenseBalance(balanceWarning, warning))) {
          setBalanceWarning(warning);
          return;
        }
      }
      setBalanceWarning(null);
      const sub = !originalId && label.trim() ? await useCases.addSubcategory.execute(categoryId, label.trim()) : null;
      if (!current()) return;
      await useCases.recordSms.execute(sms, {
        memberId: memberId || currentMemberId, type, amount: baseAmount, category: categoryId,
        date: parsedDate ? jalaliToIso(parsedDate) : sms.date!, note: smsSummary(sms), accountId, subcategoryId: sub?.id ?? null,
      }, {
        transactionId: originalId ?? undefined,
        isCurrent: current,
        onCreated: transaction => {
          const remembered = rememberSmsReceipt(scope, transaction.id);
          if (current()) {
            saved.current = transaction.id;
            knownTransactions.current.push(transaction);
            persisted.current = remembered;
            setSavedId(transaction.id);
          }
        },
      });
      if (!current()) return;
      acknowledged = true;
      clearSmsReceipt(scope);
      if (current()) advance();
    } catch (e) {
      if (current()) setError(saved.current
        ? persisted.current ? "تراکنش ثبت شد؛ تأیید پیامک ناموفق بود. دوباره تأیید کنید"
          : "تراکنش ثبت شد؛ این فرم را باز نگه دارید و پیامک را دوباره تأیید کنید"
        : e instanceof Error ? e.message : "خطا در ثبت پیامک");
    } finally {
      if (current() && (saved.current || acknowledged)) {
        try { await onDone(); }
        catch { if (current()) notify("تراکنش ثبت شد؛ دریافت اطلاعات تازه ناموفق بود"); }
      }
      if (current()) { operation.current = false; setBusy(false); }
    }
  }

  async function ignore() {
    const sms = list[idx];
    if (!sms || operation.current || saved.current || loading || loadError) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    const currentGeneration = generation.current;
    try {
      await useCases.ignoreSms.execute(sms.id);
      if (currentGeneration === generation.current) advance();
    } catch (e) {
      if (currentGeneration === generation.current) setError(e instanceof Error ? e.message : "خطا در نادیده‌گرفتن پیامک");
    } finally {
      if (currentGeneration === generation.current) { operation.current = false; setBusy(false); }
    }
  }

  function edit(change: () => void) {
    if (operation.current || saved.current) return;
    change(); setError(null); setBalanceWarning(null);
  }
  return {
    list, idx, open, busy, loading, loadError, error, savedId, amountNeedsReview, balanceWarning,
    type, categoryId, amount, date, memberId, accountId, label, entryCurrency: entryCurrency.current,
    setCategoryId: (v: string) => edit(() => { setCategoryId(v); setLabel(""); }),
    setAmount: (v: string) => edit(() => {
      const numeric = toEn(v).replace(/[٬،,\s]/g, "");
      setAmount(/^\d+$/.test(numeric) ? formatAmount(Number(numeric)) : v);
    }),
    setAccountId: (v: string) => edit(() => setAccountId(v)),
    setLabel: (v: string) => edit(() => setLabel(v)),
    changeType: (t: "expense" | "income") => edit(() => { setType(t); setCategoryId(categoriesFor(t)[0].id); setLabel(""); }),
    setDate: (v: string) => edit(() => setDate(liveFormatJalaliDate(v))),
    dismissBalanceWarning: () => { if (!operation.current) setBalanceWarning(null); },
    load, close, record, ignore, raw: list[idx]?.rawText ?? "",
  };
}
