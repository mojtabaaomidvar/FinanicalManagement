import { useEffect, useId, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { Account } from "@/domain/account/account.types";
import { MAX_AMOUNT } from "@/domain/transaction/transaction.rules";
import type { PendingWalletCorrection, WalletBalance, WalletCorrectionMode, WalletCorrectionReceipt } from "@/domain/account/wallet.types";
import { Modal, CurrencyUnit } from "@/shared/ui";
import { convertMoneyDraft } from "@/shared/lib/moneyDraft";
import { formatMoney, moneyFits, negateMoney, parseMoneyInput, subtractMoney } from "@/shared/lib/money";
import { formatISO, isoToJalali } from "@/shared/lib/jalali";
import { usePageActivity } from "@/shared/lib/pageActivity";

/** A target alone never writes. Pending operations require explicit recovery. */
export function WalletCorrectionFeature({ account, onClose, onSaved, historyOnly = false }: {
  account: Account; onClose: () => void; onSaved: () => void; historyOnly?: boolean;
}) {
  const { useCases, family, member, cur } = useApp();
  const active = usePageActivity();
  const [currency, setCurrency] = useState(cur);
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
  const targetId = useId();
  const descriptionId = useId();
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
  function switchCurrency(next: string) {
    if (writing.current) return;
    const converted = convertMoneyDraft(target, currency, next);
    if (converted === null) { setError("موجودی معتبر وارد کنید تا واحد مبلغ تغییر کند."); return; }
    setTarget(converted); setCurrency(next); setError(null);
  }
  function review() {
    if (writing.current || !balance || pending || recoveryBlocked) return;
    if (!validTarget) { setError("موجودی معتبر با دقت مجاز وارد کنید"); return; }
    if (!mode) { setError("روش اصلاح موجودی را انتخاب کنید."); return; }
    setError(null); setStep("review");
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

  return <Modal open={active && owner} onClose={close} title={historyOnly ? "سابقهٔ اصلاح موجودی" : "اصلاح موجودی"} sheetClassName="account-form-sheet wallet-correction-sheet">
    <p>{account.title}</p>
    {loading ? <p role="status">در حال دریافت موجودی و سابقه…</p> : null}
    {error !== null ? <p className="field-error" role="alert">{error}</p> : null}
    {recoveryBlocked ? <p className="field-error" role="alert">درخواست قبلی قابل بررسی نیست؛ برای جلوگیری از ثبت تکراری، درخواست تازه ارسال نمی‌شود.</p> : null}
    {pending ? <section className="bal-warn">
      <h3>بررسی نتیجهٔ درخواست قبلی</h3>
      <p>موجودی هدف: <b dir="ltr">{formatMoney(pending.request.targetBalance, cur)}</b> <CurrencyUnit /></p>
      <p>{pending.request.mode === "ledger" ? "ثبت در تراکنش‌ها" : "صرفاً اصلاح جهت مغایرت‌گیری"}</p>
      {pending.request.description !== null ? <p>{pending.request.description}</p> : null}
      <p>نتیجه نامشخص است؛ فقط همان درخواست را بررسی یا دوباره ارسال کنید.</p>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" disabled={busy || loading} onClick={() => void perform("resolve")}>بررسی نتیجه</button>
        <button type="button" className="btn-primary" disabled={busy || loading} onClick={() => void perform("retry")}>ارسال دوبارهٔ همان درخواست</button>
      </div>
    </section> : !historyOnly && !loading && balance && !recoveryBlocked && step !== "saved" ? <>
      {step === "target" ? <fieldset className="account-fields form-grid" disabled={busy}>
        <fieldset className="wallet-mode-options account-fields">
          <legend>روش اصلاح موجودی</legend>
          <label className="wallet-mode-option"><input type="radio" name="wallet-correction-mode" checked={mode === "reconciliation"} onChange={() => setMode("reconciliation")} />مغایرت‌گیری</label>
          <p className="wallet-mode-hint">موجودی نمایش‌داده‌شده اصلاح می‌شود؛ تراکنش‌های قبلی تغییر نمی‌کنند.</p>
          <label className="wallet-mode-option"><input type="radio" name="wallet-correction-mode" checked={mode === "ledger"} onChange={() => setMode("ledger")} />ثبت در تراکنش‌ها</label>
          <p className="wallet-mode-hint">یک تراکنش اصلاحی اضافه می‌شود و مغایرت‌گیری قبلی پایان می‌یابد.</p>
        </fieldset>
        {!ledgerFits ? <p className="field-error" role="alert">مبلغ اصلاح از سقف تراکنش بیشتر است؛ این روش قابل ثبت نیست.</p> : null}
        <div className="form-row wallet-target-field">
          <div className="wallet-target-label"><label htmlFor={targetId}>موجودی موردنظر</label><CurrencyUnit currency={currency} onSwitch={switchCurrency} disabled={busy} /></div>
          <input id={targetId} className="text-input" value={target} onChange={event => setTarget(event.target.value)} inputMode="decimal" dir="ltr" aria-label="موجودی موردنظر" autoComplete="off" />
        </div>
        <div className="form-row">
          <label htmlFor={descriptionId}>توضیحات</label>
          <textarea id={descriptionId} className="text-input" value={description} onChange={event => setDescription(event.target.value)} maxLength={200} aria-label="توضیحات اصلاح موجودی" rows={3} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={close}>انصراف</button>
          <button type="button" className="btn-primary" disabled={!validTarget || !mode || !ledgerFits} onClick={review}>بررسی و ادامه</button>
        </div>
      </fieldset> : <>
        <h3>بررسی اصلاح موجودی</h3>
        <p>{mode === "ledger" ? "ثبت در تراکنش‌ها" : "مغایرت‌گیری"}</p>
        <p>موجودی هدف: <b dir="ltr">{formatMoney(parsed!, currency)}</b> <CurrencyUnit currency={currency} onSwitch={switchCurrency} disabled={busy} /></p>
        {description.trim() ? <p className="wallet-correction-note">{description}</p> : null}
        {!ledgerFits ? <p className="field-error" role="alert">مبلغ اصلاح از سقف تراکنش بیشتر است؛ این روش قابل ثبت نیست.</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStep("target")}>بازگشت به مبلغ</button>
          <button type="button" className="btn-primary" disabled={busy || !mode || !ledgerFits} onClick={() => void perform("submit")}>{busy ? "در حال ثبت…" : "تأیید و ثبت اصلاح"}</button>
        </div>
      </>}
    </> : null}
    {!loading && !balance && step !== "saved" ? <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>دریافت دوبارهٔ اطلاعات</button> : null}
    {saved ? <section role="status">
      <h3>{replayed ? "نتیجهٔ ثبت قبلی بازیابی شد" : "اصلاح موجودی ثبت شد"}</h3>
    </section> : null}
    {historyError ? <section><p className="field-error">سابقه دریافت نشد؛ اطلاعات را دوباره دریافت کنید.</p><button type="button" className="btn-secondary" disabled={busy || loading} onClick={() => void load()}>دریافت دوبارهٔ سابقه</button></section> : null}
    {step === "saved" || historyOnly ? <section className="wallet-correction-history">
      {!historyOnly ? <h3>سابقهٔ اصلاح موجودی</h3> : null}
      {!loading && !historyError && !history.length ? <p>هنوز اصلاح موجودی ثبت نشده است.</p> : null}
      {history.map(receipt => <article className="account-card flat" key={receipt.id}>
        <h4>{receipt.mode === "ledger" ? "ثبت در تراکنش‌ها" : "صرفاً اصلاح جهت مغایرت‌گیری"}</h4>
        <time dateTime={receipt.createdAt}>{formatISO(isoToJalali(new Date(receipt.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" })))}</time>
        {receipt.id === balance?.activeReconciliationId ? <p>مغایرت‌گیری فعال</p> : null}
        {receipt.description !== null ? <p>{receipt.description}</p> : null}
      </article>)}
    </section> : null}
    {historyOnly || step !== "target" || pending || loading || !balance || recoveryBlocked ? <div className="modal-actions"><button type="button" className="btn-secondary" disabled={busy || loading} onClick={close}>بستن</button></div> : null}
  </Modal>;
}
