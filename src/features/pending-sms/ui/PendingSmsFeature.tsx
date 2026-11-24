/* UI مودال پیامک‌های ثبت‌نشده — رسیدگی یکی‌یکی */

import { useEffect, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type { usePendingSmsModel } from "../model/usePendingSmsModel";
import {
  Field,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import { categoriesFor } from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";
import { transactionAccountChoices } from "@/features/transaction-form/model/transactionAccounts";
import { parseScheduledAmount } from "@/domain/transaction/recurring.rules";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatAccountAmount } from "@/shared/lib/format";
import { suggestSmsAccount } from "@/domain/sms/sms-parser-account-suggestion";
import { BankPaymentFields } from "@/features/transaction-form/ui/BankPaymentFields";
import { useTransferFeeQuote } from "@/features/transaction-form/model/useTransferFeeQuote";

export function PendingSmsFeature({ model: m }: { model: ReturnType<typeof usePendingSmsModel> }) {
  const { member, members, accounts, txs, subcategories, refreshData, useCases } = useApp();
  const [showAll, setShowAll] = useState(false);
  const amount = parseScheduledAmount(m.amount, m.entryCurrency);
  const ownCount = accounts.filter(account => account.memberId === member?.id).length;
  const bankExpense = m.type === "expense" && accounts.find(account => account.id === m.accountId)?.kind === "bank";
  const quote = useTransferFeeQuote(useCases, `${member?.id}:${m.list[m.idx]?.id}:${m.type}:${m.accountId}`,
    m.open && !m.savedId && bankExpense && m.paymentMethod === "bank_transfer" ? m.feeMethod : "", amount);
  const choices = transactionAccountChoices(accounts, txs, member?.id ?? "", amount,
    m.type === "expense" && !m.savedId, showAll || m.type === "income" || !!m.savedId)
    .filter(({ account, balance }) => m.savedId || m.type !== "expense" || account.kind !== "bank" || amount === null || balance >= amount + quote.rial / 10);
  useEffect(() => { setShowAll(false); }, [m.list[m.idx]?.id, m.type]);
  useEffect(() => {
    if (!m.savedId && m.accountId && !choices.some(row => row.account.id === m.accountId)) m.setAccountId("");
  }, [m.accountId, m.savedId, choices]);
  const subsOfCategory = subcategories.filter(s => s.category === m.categoryId);
  const suggestion = suggestSmsAccount(m.raw, accounts, members, member?.id ?? "");
  const suggestionAvailable = suggestion.account && transactionAccountChoices(accounts, txs, member?.id ?? "", amount,
    m.type === "expense", true).some(row => row.account.id === suggestion.account?.id);

  return (
    <>
    <Modal open={m.open} onClose={m.close}>
      <div className="pending-head">
        <h3>پیامک‌های ثبت‌نشده</h3>
        {m.list.length > 0 && !m.loadError ? <span className="badge">
          {toFa(m.idx + 1)} از {toFa(m.list.length)}
        </span> : null}
      </div>

      {m.loading ? <p className="section-hint" role="status">در حال دریافت پیامک‌ها…</p> : null}
      {m.loadError ? <div role="alert">
        <p className="field-error">{m.loadError}</p>
        <button type="button" className="btn-secondary" disabled={m.loading} onClick={() => void m.load({ review: true })}>
          دریافت دوباره پیامک‌ها
        </button>
      </div> : null}
      {!m.loading && !m.loadError && m.list.length > 0 ? <>
      {m.savedId ? <p className="section-hint" role="status">رسید ثبت قبلی در این مرورگر پیدا شد؛ فقط پیوند پیامک به همان تراکنش بازیابی می‌شود.</p> : null}
      {m.amountNeedsReview && !m.savedId ? <p className="section-hint">واحد مبلغ پیامک مشخص نیست؛ مبلغ را در واحد انتخابی وارد کنید.</p> : null}
      <p className="section-hint">ثبت برای <b>{member?.name}</b></p>
      {!m.savedId && (suggestion.member || suggestion.account) ? <div className="sms-account-suggestion">
        {suggestion.member ? <p>نام احتمالی در پیامک: <b>{suggestion.member.name}</b></p> : null}
        {suggestion.member && suggestion.member.id !== member?.id ? <p className="section-hint">نام عضو دیگری در پیامک دیده می‌شود؛ ثبت همچنان فقط از حساب‌های خودتان انجام می‌شود.</p> : null}
        {suggestion.account ? <>
          <p>حساب پیشنهادی: <b>{suggestion.account.title}</b></p>
          <button type="button" className="btn-secondary" disabled={m.busy || !suggestionAvailable} onClick={() => {
            setShowAll(true); m.setAccountId(suggestion.account!.id);
          }}>انتخاب حساب پیشنهادی</button>
          {!suggestionAvailable ? <p className="field-error">موجودی حساب پیشنهادی برای این هزینه کافی نیست.</p> : null}
        </> : null}
        <p className="section-hint">پیشنهاد را با متن پیامک بررسی کنید.</p>
      </div> : null}
      <div>
        <div className="pending-progress">
          <div
            className="pending-progress-fill"
            style={{
              width: `${((m.idx + 1) / Math.max(m.list.length, 1)) * 100}%`,
            }}
          />
        </div>
        <div className="pending-card">
          <div className="pending-raw">{m.raw}</div>
          <fieldset disabled={m.busy || !!m.savedId} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="pending-fields form-grid">
            <Field label="نوع تراکنش">
              <Select
                aria-label="نوع تراکنش پیامک"
                value={m.type}
                onChange={(v) => m.changeType(v as "expense" | "income")}
                options={[
                  { value: "expense", label: "هزینه" },
                  { value: "income", label: "درآمد" },
                ]}
              />
            </Field>
            <Field label="مبلغ">
              <div className="amt-field">
              <TextInput
                value={m.amount}
                onChange={m.setAmount}
                className="num-input"
                inputMode="decimal"
                aria-label="مبلغ پیامک"
              />
              <span className="cur-suffix">{currencyDisplayLabel(m.entryCurrency)}</span>
              </div>
            </Field>
            <Field label="دسته‌بندی">
              <Select
                aria-label="دسته‌بندی پیامک"
                value={m.categoryId}
                onChange={(v) => m.setCategoryId(v)}
                options={categoriesFor(m.type).map((c) => ({
                  value: c.id,
                  label: c.name,
                }))}
              />
            </Field>
            <Field label="لیبل (اختیاری)">
              <TextInput
                aria-label="لیبل پیامک"
                value={m.label}
                onChange={m.setLabel}
                placeholder="مثلاً نانوایی، اسنپ، اجاره…"
                maxLength={30}
              />
              {subsOfCategory.length ? (
                <div className="quick-chips">
                  {subsOfCategory.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={`chip ${m.label === s.name ? "active" : ""}`}
                      onClick={() => m.setLabel(s.name)}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </Field>
            <Field label="حساب (الزامی)">
              <Select
                aria-label="حساب پیامک"
                value={m.accountId}
                onChange={m.setAccountId}
                options={[
                  {
                    value: "",
                    label: ownCount ? "حساب یا کیف‌پول خود را انتخاب کنید…" : "حساب یا کیف‌پولی برای شما ثبت نشده",
                  },
                  ...choices.map(({ account, balance }) => ({
                    value: account.id,
                    label: /* @copy-text sms.review.account_choice */ `${account.title} · ${formatAccountAmount(balance, m.entryCurrency)} ${currencyDisplayLabel(m.entryCurrency)}`,
                  })),
                ]}
              />
              {m.type === "expense" && !m.savedId ? <button type="button" className="tx-all-accounts" disabled={m.busy}
                onClick={() => setShowAll(value => !value)}>{showAll ? "نمایش فهرست کوتاه" : "نمایش همهٔ حساب‌های من"}</button> : null}
              {!m.savedId && !choices.length ? <p className="field-error">حساب یا کیف‌پول با موجودی کافی برای این مبلغ ندارید؛ مبلغ یا فهرست کامل حساب‌ها را بررسی کنید.</p> : null}
            </Field>
            {bankExpense && !m.savedId ? <BankPaymentFields mode="expense" choice={m.feeChoice} method={m.feeMethod}
              paymentMethod={m.paymentMethod} onPaymentMethod={m.setPaymentMethod}
              onChoice={m.setFeeChoice} onMethod={m.setFeeMethod} loading={quote.loading} error={quote.error} /> : null}
            <Field label="تاریخ انجام تراکنش">
              <JalaliDateInput value={m.date} onChange={m.setDate} aria-label="تاریخ انجام تراکنش" />
              {!m.date ? <p className="section-hint">تاریخ معتبر در پیامک پیدا نشد؛ تاریخ انجام تراکنش را انتخاب کنید.</p> : null}
            </Field>
            <Field label="ساعت انجام تراکنش (اختیاری)">
              <TextInput value={m.time} onChange={m.setTime} aria-label="ساعت انجام تراکنش" placeholder="مثلاً ۱۴:۳۷:۵۲" className="num-input" inputMode="text" />
              {!m.time ? <p className="section-hint">ساعت انجام تراکنش نامعلوم است؛ زمان دریافت پیامک جایگزین آن نمی‌شود.</p> : null}
            </Field>
            <Field label="شرح تراکنش (اختیاری)">
              <TextInput value={m.note} onChange={m.setNote} aria-label="شرح تراکنش پیامک" maxLength={200} />
            </Field>
          </div>
          </fieldset>
        </div>
      </div>

      {m.error ? <p className="field-error" role="alert">{m.error}</p> : null}
      <div className="pending-actions">
        <button type="button" className="btn-ghost-danger" disabled={m.busy || !!m.savedId} onClick={() => void m.ignore()}>
          نادیده
        </button>
        <button type="button" className="btn-ghost" disabled={m.busy} onClick={m.close}>
          بعداً
        </button>
        <button
          className="btn-primary"
          type="button"
          disabled={m.busy}
          onClick={() => m.record(refreshData, ownCount)}
        >
          {m.busy ? "در حال رسیدگی…" : m.savedId ? "بازیابی پیوند پیامک" : "ثبت"}
        </button>
      </div>
      </> : null}
    </Modal>
    </>
  );
}
