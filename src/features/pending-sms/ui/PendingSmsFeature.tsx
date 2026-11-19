/* UI مودال پیامک‌های ثبت‌نشده — رسیدگی یکی‌یکی */

import { useEffect, useId, useRef } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { usePendingSmsModel } from "../model/usePendingSmsModel";
import {
  Field,
  JalaliDateInput,
  Modal,
  Select,
  TextInput,
} from "@/shared/ui";
import { categoriesFor } from "@/domain/category/category.catalog";
import { toFa } from "@/shared/lib/digits";
import { toDisplay } from "@/shared/lib/currency";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatSignedAmount } from "@/shared/lib/format";

export function PendingSmsFeature({ refreshKey }: { refreshKey: number }) {
  const { useCases, member, cur, accounts, subcategories, refreshData } =
    useApp();
  const { show } = useToast();
  const m = usePendingSmsModel(useCases!, member?.id ?? "", show, cur);
  const balanceRef = useRef<HTMLDivElement>(null);
  const balanceTitleId = useId();
  const balanceDescriptionId = useId();
  useEffect(() => {
    if (m.balanceWarning) balanceRef.current?.focus();
  }, [m.balanceWarning]);

  const subsOfCategory = subcategories.filter(
    (s) => s.category === m.categoryId,
  );

  /* بارگذاری پیامک‌های pending هنگام ورود به نرم‌افزار و پس از هر تغییر داده */
  useEffect(() => {
    if (!m.open) void m.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, useCases, member?.id]);

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
        <button type="button" className="btn-secondary" disabled={m.loading} onClick={() => void m.load()}>
          دریافت دوباره پیامک‌ها
        </button>
      </div> : null}
      {!m.loading && !m.loadError && m.list.length > 0 ? <>
      {m.savedId ? <p className="section-hint" role="status">تراکنش ثبت شده؛ فقط تأیید پیامک باقی مانده است.</p> : null}
      {m.amountNeedsReview && !m.savedId ? <p className="section-hint">واحد مبلغ پیامک مشخص نیست؛ مبلغ را در واحد انتخابی وارد کنید.</p> : null}
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
                    label: accounts.length ? "انتخاب کنید…" : "کارتی ثبت نشده",
                  },
                  ...accounts.map((a) => ({
                    value: a.id,
                    label: a.title + (a.bank ? " · " + a.bank : ""),
                  })),
                ]}
              />
            </Field>
            <Field label="تاریخ">
              <JalaliDateInput value={m.date} onChange={m.setDate} aria-label="تاریخ پیامک" />
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
          onClick={() => m.record(refreshData, accounts.length)}
        >
          {m.busy ? "در حال رسیدگی…" : m.savedId ? "تأیید دوباره پیامک" : "ثبت"}
        </button>
      </div>
      </> : null}
    </Modal>
    <Modal open={m.open && !!m.balanceWarning} onClose={m.dismissBalanceWarning}
      overlayClassName="tx-balance-overlay" sheetClassName="tx-balance-popup" padded={false}>
      {m.balanceWarning ? <div ref={balanceRef} className="tx-balance-warning" role="alertdialog" aria-modal="true"
        aria-labelledby={balanceTitleId} aria-describedby={balanceDescriptionId} tabIndex={-1}
        onKeyDown={event => {
          if (event.key !== "Tab") return;
          const buttons = balanceRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
          if (!buttons?.length) { event.preventDefault(); return; }
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === balanceRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === balanceRef.current)) {
            event.preventDefault(); first.focus();
          }
        }}>
        <h3 id={balanceTitleId}>موجودی کافی نیست</h3>
        <p id={balanceDescriptionId}>با ثبت این هزینه، موجودی حساب منفی می‌شود.</p>
        <p className="tx-balance-account">{m.balanceWarning.account.title}</p>
        <div className="tx-balance-result">
          <span>مانده پس از ثبت</span>
          <b className="tx-balance-remaining" dir="ltr">{formatSignedAmount(toDisplay(m.balanceWarning.remaining, m.entryCurrency))}</b>
          <span>{currencyDisplayLabel(m.entryCurrency)}</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={m.busy} onClick={m.dismissBalanceWarning}>اصلاح مبلغ</button>
          <button type="button" className="btn-primary" disabled={m.busy} onClick={() => void m.record(refreshData, accounts.length, true)}>تأیید و ثبت</button>
        </div>
      </div> : null}
    </Modal>
    </>
  );
}
