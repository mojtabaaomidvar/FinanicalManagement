import { useEffect, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { Account } from "@/domain/account/account.types";
import { MAX_AMOUNT } from "@/domain/transaction/transaction.rules";
import type { PendingWalletCorrection, WalletBalance, WalletCorrectionMode, WalletCorrectionReceipt } from "@/domain/account/wallet.types";
import { Field, Modal, TextInput } from "@/shared/ui";
import { formatMoney, moneyFits, negateMoney, parseMoneyInput, subtractMoney } from "@/shared/lib/money";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatISO, isoToJalali } from "@/shared/lib/jalali";
import { usePageActivity } from "@/shared/lib/pageActivity";

/** A target alone never writes. Pending operations require explicit recovery. */
export function WalletCorrectionFeature({ account, onClose, onSaved }: {
  account: Account; onClose: () => void; onSaved: () => void;
}) {
  const { useCases, family, member, cur } = useApp();
  const active = usePageActivity();
  const [currency] = useState(cur);
  const scope = { familyId: family?.id ?? "", memberId: member?.id ?? "", accountId: account.id };
  const scopeKey = JSON.stringify(scope);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const mounted = useRef(true);
  const writing = useRef(false);
  const seeded = useRef(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [history, setHistory] = useState<WalletCorrectionReceipt[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [pending, setPending] = useState<PendingWalletCorrection | null>(null);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<WalletCorrectionMode | null>(null);
  const [step, setStep] = useState<"target" | "review" | "saved">("target");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<WalletCorrectionReceipt | null>(null);
  const [replayed, setReplayed] = useState(false);
  const owner = account.familyId === family?.id && account.memberId === member?.id;
  function isCurrent() { return mounted.current && currentScope.current === scopeKey; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function load() {
    if (!useCases || !owner || writing.current) return;
    writing.current = true; setLoading(true); setError(null); setBalance(null);
    try {
      const results = await Promise.allSettled([
        useCases.walletCorrections.balance(scope), useCases.walletCorrections.history(scope), useCases.walletCorrections.pending(scope),
      ]);
      if (!isCurrent()) return;
      const [snapshot, receipts, retained] = results;
      if (snapshot.status === "fulfilled") {
        setBalance(snapshot.value);
        if (!seeded.current) { setTarget(formatMoney(snapshot.value.currentBalance, currency)); seeded.current = true; }
      } else setError("دریافت موجودی ممکن نشد؛ بدون موجودی تازه اصلاحی ارسال نمی‌شود.");
      setHistoryError(receipts.status === "rejected");
      setHistory(receipts.status === "fulfilled" ? receipts.value : []);
      setRecoveryBlocked(retained.status === "rejected");
      setPending(retained.status === "fulfilled" ? retained.value : null);
    } finally {
      if (isCurrent()) { writing.current = false; setLoading(false); }
    }
  }
  useEffect(() => { if (active) void load(); }, [active, scopeKey, useCases]);

  const parsed = parseMoneyInput(target, currency);
  const validTarget = parsed !== null && moneyFits(parsed, { scale: 2, min: "-999999999999999", max: "999999999999999" });
  const delta = balance && parsed !== null && mode ? subtractMoney(parsed, mode === "ledger" ? balance.ledgerBalance : balance.currentBalance) : null;
  const ledgerFits = delta === null || mode !== "ledger" || moneyFits(delta, { scale: 2, min: negateMoney(MAX_AMOUNT), max: MAX_AMOUNT });
  function close() { if (!writing.current) onClose(); }
  function review() {
    if (writing.current || !balance || pending || recoveryBlocked) return;
    if (!validTarget) { setError("موجودی معتبر با دقت مجاز وارد کنید"); return; }
    setError(null); setMode(null); setStep("review");
  }

  async function perform(action: "submit" | "resolve" | "retry") {
    if (!useCases || !owner || writing.current || recoveryBlocked) return;
    if (action === "submit" && (!balance || !validTarget || !mode || !ledgerFits || step !== "review" || pending)) return;
    if (action !== "submit" && !pending) return;
    writing.current = true; setBusy(true); setError(null);
    try {
      const wallet = useCases.walletCorrections;
      const result = action === "resolve" ? await wallet.resolve(scope) : action === "retry" ? await wallet.retry(scope)
        : await wallet.submit(scope, { baseRevision: balance!.revision, targetBalance: parsed!, mode: mode!, description: description.trim() || null });
      if (!isCurrent()) return;
      if (!("receipt" in result)) {
        setError("نتیجه هنوز مشخص نیست؛ برای تلاش دوباره فقط همان درخواست قبلی ارسال می‌شود.");
        return;
      }
      if ("receipt" in result) {
        setSaved(result.receipt); setReplayed(result.replayed); setStep("saved");
        setPending(null); setMode(null); onSaved();
        // A refresh failure must not relabel a confirmed server commit as failure.
        const fresh = await Promise.allSettled([wallet.balance(scope), wallet.history(scope)]);
        if (!isCurrent()) return;
        setBalance(fresh[0].status === "fulfilled" ? fresh[0].value : null);
        setHistoryError(fresh[1].status === "rejected");
        if (fresh[1].status === "fulfilled") setHistory(fresh[1].value);
      }
    } catch (cause) {
      if (!isCurrent()) return;
      setError((cause as Error).message || "اصلاح موجودی انجام نشد؛ نتیجه را بررسی کنید.");
      try {
        const retained = await useCases.walletCorrections.pending(scope);
        if (!isCurrent()) return;
        setPending(retained);
        // A definitive rejection needs a fresh balance and a new explicit review.
        if (!retained) { setBalance(null); setMode(null); setStep("target"); }
      } catch { if (isCurrent()) setRecoveryBlocked(true); }
    } finally {
      if (isCurrent()) { writing.current = false; setBusy(false); }
    }
  }

  return <Modal open={active && owner} onClose={close} title="اصلاح موجودی" sheetClassName="account-form-sheet">
    <p>{account.title}</p>
    {loading ? <p role="status">در حال دریافت موجودی و سابقه…</p> : null}
    {error !== null ? <p className="field-error" role="alert">{error}</p> : null}
    {recoveryBlocked ? <p className="field-error" role="alert">درخواست قبلی قابل بررسی نیست؛ برای جلوگیری از ثبت تکراری، درخواست تازه ارسال نمی‌شود.</p> : null}
    {pending ? <section className="bal-warn">
      <h3>بررسی نتیجهٔ درخواست قبلی</h3>
      <p>موجودی هدف: <b dir="ltr">{formatMoney(pending.request.targetBalance, currency)}</b> {currencyDisplayLabel(currency)}</p>
      <p>{pending.request.mode === "ledger" ? "ثبت در تراکنش‌ها" : "صرفاً اصلاح جهت مغایرت‌گیری"}</p>
      {pending.request.description !== null ? <p>{pending.request.description}</p> : null}
      <p>هنوز درخواست تازه‌ای ثبت نکنید. تلاش دوباره شناسه، مبلغ و روش همان درخواست را حفظ می‌کند.</p>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" disabled={busy || loading} onClick={() => void perform("resolve")}>بررسی نتیجه</button>
        <button type="button" className="btn-primary" disabled={busy || loading} onClick={() => void perform("retry")}>ارسال دوبارهٔ همان درخواست</button>
      </div>
    </section> : !loading && balance && !recoveryBlocked && step !== "saved" ? <>
      <p>موجودی فعلی: <b dir="ltr">{formatMoney(balance.currentBalance, currency)}</b> {currencyDisplayLabel(currency)}</p>
      <p>موجودی حاصل از تراکنش‌ها: <b dir="ltr">{formatMoney(balance.ledgerBalance, currency)}</b> {currencyDisplayLabel(currency)}</p>
      {step === "target" ? <fieldset className="account-fields form-grid" disabled={busy}>
        <Field label="موجودی هدف"><TextInput value={target} onChange={setTarget} inputMode="decimal" dir="ltr" aria-label="موجودی هدف" autoComplete="off" /></Field>
        <p className="modal-sub">واحد این فرم ثابت است: {currencyDisplayLabel(currency)}. برای موجودی منفی، علامت منفی را وارد کنید.</p>
        <Field label="توضیح اصلاح (اختیاری)"><TextInput value={description} onChange={setDescription} maxLength={200} aria-label="توضیح اصلاح موجودی" /></Field>
        <button type="button" className="btn-primary" disabled={!validTarget} onClick={review}>بررسی روش ثبت</button>
      </fieldset> : <>
        <fieldset className="account-fields" disabled={busy}>
          <legend>نحوه ثبت اصلاح موجودی را انتخاب کنید.</legend>
          <label className="bal-warn-ack"><input type="radio" name="wallet-correction-mode" checked={mode === "ledger"} onChange={() => setMode("ledger")} />ثبت در تراکنش‌ها</label>
          <p className="modal-sub">تفاوت با موجودی حاصل از تراکنش‌ها، به‌عنوان تراکنش اصلاحی ثبت می‌شود؛ مغایرت‌گیری قبلی پایان می‌یابد.</p>
          <label className="bal-warn-ack"><input type="radio" name="wallet-correction-mode" checked={mode === "reconciliation"} onChange={() => setMode("reconciliation")} />صرفاً اصلاح جهت مغایرت‌گیری</label>
          <p className="modal-sub">فقط موجودی اصلاح‌شده و سابقه ذخیره می‌شود؛ درآمد، هزینه و تراکنش‌های قبلی تغییر نمی‌کنند.</p>
        </fieldset>
        <p>موجودی هدف: <b dir="ltr">{formatMoney(parsed!, currency)}</b> {currencyDisplayLabel(currency)}</p>
        {delta !== null ? <p>مبلغ تغییر: <b dir="ltr">{formatMoney(delta, currency)}</b> {currencyDisplayLabel(currency)}</p> : null}
        {!ledgerFits ? <p className="field-error" role="alert">مبلغ اصلاح از سقف تراکنش بیشتر است؛ این روش قابل ثبت نیست.</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => { setStep("target"); setMode(null); }}>بازگشت به مبلغ</button>
          <button type="button" className="btn-primary" disabled={busy || !mode || !ledgerFits} onClick={() => void perform("submit")}>{busy ? "در حال ثبت…" : "تأیید و ثبت اصلاح"}</button>
        </div>
      </>}
    </> : null}
    {!loading && !balance && step !== "saved" ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>دریافت دوبارهٔ اطلاعات</button> : null}
    {saved ? <section role="status">
      <h3>{replayed ? "نتیجهٔ ثبت قبلی بازیابی شد" : "اصلاح موجودی ثبت شد"}</h3>
      <p>موجودی پس از اصلاح: <b dir="ltr">{formatMoney(saved.currentAfter, currency)}</b> {currencyDisplayLabel(currency)}</p>
    </section> : null}
    <section>
      <h3>سابقهٔ اصلاح موجودی</h3>
      {historyError ? <><p className="field-error">سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.</p><button type="button" className="btn-secondary" disabled={busy || loading} onClick={() => void load()}>دریافت دوبارهٔ سابقه</button></> : !loading && !history.length ? <p>هنوز اصلاح موجودی ثبت نشده است.</p> : null}
      {history.map(receipt => <article className="account-card flat" key={receipt.id}>
        <h4>{receipt.mode === "ledger" ? "ثبت در تراکنش‌ها" : "صرفاً اصلاح جهت مغایرت‌گیری"}</h4>
        <time dateTime={receipt.createdAt}>{formatISO(isoToJalali(new Date(receipt.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" })))}</time>
        {receipt.id === balance?.activeReconciliationId ? <p>مغایرت‌گیری فعال</p> : null}
        <p>موجودی قبل: <b dir="ltr">{formatMoney(receipt.currentBefore, currency)}</b> {currencyDisplayLabel(currency)}</p>
        <p>مبلغ تغییر: <b dir="ltr">{formatMoney(receipt.delta, currency)}</b> {currencyDisplayLabel(currency)}</p>
        <p>موجودی حاصل از تراکنش‌ها قبل از اصلاح: <b dir="ltr">{formatMoney(receipt.ledgerBefore, currency)}</b> {currencyDisplayLabel(currency)}</p>
        <p>موجودی پس از اصلاح: <b dir="ltr">{formatMoney(receipt.currentAfter, currency)}</b> {currencyDisplayLabel(currency)}</p>
        <p>موجودی حاصل از تراکنش‌ها پس از اصلاح: <b dir="ltr">{formatMoney(receipt.ledgerAfter, currency)}</b> {currencyDisplayLabel(currency)}</p>
        {receipt.description !== null ? <p>{receipt.description}</p> : null}
        {receipt.transactionId ? <p>تراکنش اصلاحی مرتبط: <b dir="ltr">{receipt.transactionId}</b></p> : null}
      </article>)}
    </section>
    <div className="modal-actions"><button type="button" className="btn-secondary" disabled={busy || loading} onClick={close}>بستن</button></div>
  </Modal>;
}
