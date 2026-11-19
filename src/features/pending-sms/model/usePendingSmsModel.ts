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
import { expenseBalanceWarning } from "@/features/transaction-form/model/expenseBalance";
import { clearSmsReceipt, readSmsReceipt, rememberSmsReceipt } from "./pendingSmsReceipt";
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
  const [memberId, setMemberId] = useState(currentMemberId);
  const [accountId, setAccountId] = useState("");
  const [label, setLabel] = useState("");
  const operation = useRef(false);
  const saved = useRef<string | null>(null);
  const persisted = useRef(true);
  const generation = useRef(0);
  const readTurn = useRef(0);
  const reviewTarget = useRef<string | true | null>(null);
  const entryCurrency = useRef(currency);
  const knownTransactions = useRef<Transaction[]>([]);

  useEffect(() => {
    generation.current++; readTurn.current++; operation.current = false;
    saved.current = null; knownTransactions.current = []; reviewTarget.current = null;
    setOpen(false); setList([]); setSavedId(null); setBusy(false); setLoading(false);
    return () => { generation.current++; readTurn.current++; };
  }, [useCases, currentMemberId, enabled]);

  function hydrate(sms: BankSms) {
    const d = smsDraftDefaults(sms, currentMemberId);
    const transactionId = readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
    const original = knownTransactions.current.find(tx => tx.id === transactionId && tx.familyId === sms.familyId && tx.memberId === currentMemberId);
    const draft = original ? null : readPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
    saved.current = transactionId;
    setSavedId(transactionId);
    persisted.current = true;
    entryCurrency.current = currency;
    const draftType = draft?.type ?? d.type;
    setType(original?.type === "income" ? "income" : original ? "expense" : draftType);
    setCategoryId(original?.category ?? draft?.categoryId ?? d.categoryId);
    const baseAmount = original?.amount ?? d.amount;
    const draftNumeric = draft ? Number(toEn(draft.amount).replace(/[٬،,\s]/g, "")) : null;
    setAmount(draft ? draftNumeric && Number.isFinite(draftNumeric)
      ? formatAmount(toDisplay(fromDisplay(draftNumeric, draft.currency), currency)) : draft.amount
      : baseAmount ? formatAmount(toDisplay(baseAmount, currency)) : "");
    setAmountNeedsReview(d.amountNeedsReview);
    setDate(original ? formatISO(isoToJalali(original.date)) : draft?.date ?? formatISO(d.jalaliDate));
    setMemberId(currentMemberId);
    setAccountId(original?.accountId ?? draft?.accountId ?? sms.accountId ?? "");
    setLabel(draft?.label ?? "");
    setError(null);
  }

  async function load(options: { review?: boolean; smsId?: string } = {}) {
    if (!enabled || operation.current) return;
    if (options.review) reviewTarget.current = options.smsId ?? reviewTarget.current ?? true;
    const mine = ++readTurn.current;
    const currentGeneration = generation.current;
    setLoading(true);
    setLoadError(null);
    try {
      const pending = (await useCases.listPendingSms.execute()).filter(sms => !sms.memberId || sms.memberId === currentMemberId);
      const hasReceipts = pending.some(sms => readSmsReceipt({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id }));
      const transactions = hasReceipts ? await useCases.listTransactions.execute() : [];
      if (mine !== readTurn.current || currentGeneration !== generation.current) return;
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
      if (mine !== readTurn.current || currentGeneration !== generation.current) return;
      setLoadError(e instanceof Error ? e.message : "خطا در دریافت پیامک‌ها");
      if (reviewTarget.current !== null) setOpen(true);
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
        if (originalId) { clearSmsReceipt(scope); clearPendingDraft(scope); advance(); acknowledged = true; }
        else setError("این پیامک دیگر در انتظار ثبت نیست؛ فهرست را دوباره دریافت کنید");
        return;
      }
      const account = accounts.find(item => item.id === accountId);
      if (!originalId && (!account || account.memberId !== currentMemberId)) {
        setAccountId(""); return setError("فقط حساب‌ها و کیف‌پول‌های خودتان قابل انتخاب‌اند.");
      }
      const currentSms = pending.find(item => item.id === sms.id);
      if (currentSms?.memberId && currentSms.memberId !== currentMemberId) return setError("این پیامک متعلق به شما نیست.");
      const baseAmount = fromDisplay(amt, entryCurrency.current);
      if (!originalId && type === "expense" && account) {
        if (expenseBalanceWarning(account, transactions, baseAmount)) {
          setAccountId("");
          return setError("موجودی این حساب برای مبلغ واردشده کافی نیست؛ حساب دیگری انتخاب کنید.");
        }
      }
      const sub = !originalId && label.trim() ? await useCases.addSubcategory.execute(categoryId, label.trim()) : null;
      if (!current()) return;
      await useCases.recordSms.execute(sms, {
        requireAvailableBalance: true, memberId: currentMemberId, type, amount: baseAmount, category: categoryId,
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
      clearPendingDraft(scope);
      if (current()) advance();
    } catch (e) {
      if (current()) setError(saved.current
        ? persisted.current ? "تراکنش ثبت شد؛ تأیید پیامک ناموفق بود. دوباره تأیید کنید"
          : "تراکنش ثبت شد؛ این فرم را باز نگه دارید و پیامک را دوباره تأیید کنید"
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
    if (!sms || operation.current || saved.current || loading || loadError) return;
    operation.current = true;
    setBusy(true);
    setError(null);
    const currentGeneration = generation.current;
    try {
      await useCases.ignoreSms.execute(sms.id);
      if (currentGeneration === generation.current) {
        clearPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id });
        advance();
      }
    } catch (e) {
      if (currentGeneration === generation.current) setError(e instanceof Error ? e.message : "خطا در نادیده‌گرفتن پیامک");
    } finally {
      if (currentGeneration === generation.current) { operation.current = false; setBusy(false); }
    }
  }

  function edit(patch: Partial<PendingSmsDraft>) {
    if (operation.current || saved.current) return;
    const next: PendingSmsDraft = { type, categoryId, amount, currency: entryCurrency.current, date, accountId, label, ...patch };
    const sms = list[idx];
    if (sms && !rememberPendingDraft({ familyId: sms.familyId, memberId: currentMemberId, smsId: sms.id }, next))
      notify("پیش‌نویس بررسی پیامک در این مرورگر ذخیره نشد؛ پیش از بستن فرم آن را ثبت کنید.");
    setType(next.type); setCategoryId(next.categoryId); setAmount(next.amount);
    setDate(next.date); setAccountId(next.accountId); setLabel(next.label); setError(null);
  }
  return {
    list, idx, open, busy, loading, loadError, error, savedId, amountNeedsReview,
    type, categoryId, amount, date, memberId, accountId, label, entryCurrency: entryCurrency.current,
    setCategoryId: (v: string) => edit({ categoryId: v, label: "" }),
    setAmount: (v: string) => {
      const numeric = toEn(v).replace(/[٬،,\s]/g, "");
      edit({ amount: /^\d+$/.test(numeric) ? formatAmount(Number(numeric)) : v });
    },
    setAccountId: (v: string) => edit({ accountId: v }),
    setLabel: (v: string) => edit({ label: v }),
    changeType: (t: "expense" | "income") => edit({ type: t, categoryId: categoriesFor(t)[0].id, label: "" }),
    setDate: (v: string) => edit({ date: liveFormatJalaliDate(v) }),
    load, close, record, ignore, raw: list[idx]?.rawText ?? "",
  };
}
