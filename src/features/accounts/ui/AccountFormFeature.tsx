/* Opening balance belongs to creation; editing changes metadata only. */

import { useId, useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";

import {
  Field,
  Icon,
  Modal,
  Segmented,
  Select,
  TextInput,
  expressionInputCaret,
  normalizeExpressionInput,
} from "@/shared/ui";
import { InputCurrencyUnit } from "@/shared/ui/InputCurrencyUnit";
import { BANK_OPTIONS, bankDisplayLabel } from "@/shared/lib/banks";
import type { AccountKind } from "@/domain/account/account.types";
import type { AccountsModel } from "../model/useAccountsModel";
import { WALLET_PRESETS } from "../model/useAccountsModel";

export function AccountFormFeature({ m }: { m: AccountsModel }) {
  const editing = m.editing;
  const kind = m.form.kind;
  const isWallet = kind === "wallet";
  const cardVisible = !editing || m.revealed.has(editing.id);
  const balanceId = useId();
  const amountRef = useRef<HTMLInputElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const next = selection.current;
    selection.current = null;
    if (next && document.activeElement === amountRef.current) amountRef.current?.setSelectionRange(next.start, next.end);
  });

  function changeAmount(raw: string, start: number, end = start) {
    const formatted = normalizeExpressionInput(raw);
    selection.current = { start: expressionInputCaret(raw, formatted, start), end: expressionInputCaret(raw, formatted, end) };
    m.patch({ balance: formatted });
  }

  function amountChanged(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    changeAmount(input.value, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length);
  }

  function amountKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const input = event.currentTarget, start = input.selectionStart;
    if (start === null || start !== input.selectionEnd) return;
    if (event.key === "Backspace" && input.value[start - 1] === ",") {
      event.preventDefault();
      changeAmount(input.value.slice(0, start - 2) + input.value.slice(start), start - 2);
    } else if (event.key === "Delete" && input.value[start] === ",") {
      event.preventDefault();
      changeAmount(input.value.slice(0, start) + input.value.slice(start + 2), start);
    }
  }

  const title = editing
    ? isWallet
      ? "ویرایش کیف‌پول"
      : "ویرایش حساب بانکی"
    : isWallet
      ? "کیف‌پول جدید"
      : "حساب بانکی جدید";

  return (
    <Modal open={m.open && !m.deleting} onClose={m.close} title={title} sheetClassName="account-form-sheet">
      <fieldset className="account-fields form-grid" disabled={m.locked} aria-busy={m.locked} style={{ marginTop: 8 }}>
        {/* هر دو فرم ساختار یکسان دارند؛ نوع حساب موجود ثابت می‌ماند. */}
        <fieldset className="account-kind-choice form-row full" disabled={editing !== null}>
          <Field label="نوع حساب">
            <Segmented
              value={kind}
              onChange={(v) => m.patch({ kind: v as AccountKind })}
              options={[
                { value: "bank", label: "حساب و کارت بانکی" },
                { value: "wallet", label: "کیف پول نقدی" },
              ]}
            />
          </Field>
        </fieldset>

        {!editing && !isWallet && m.canAddForChild && m.children.length ? <div className="form-row full">
          <Field label="صاحب حساب"><Select value={m.form.memberId} onChange={memberId => m.patch({ memberId })}
            aria-label="صاحب حساب" options={[
              { value: m.member?.id ?? "", label: "خودم" },
              ...m.children.map(child => ({ value: child.id, label: child.name })),
            ]} /></Field>
          <p className="modal-sub">مدیر می‌تواند برای فرزند حساب اضافه کند؛ ویرایش و حذف فقط با صاحب حساب است.</p>
        </div> : null}

        <div className="form-row full">
          <Field label={isWallet ? "نام کیف‌پول" : "عنوان کارت/حساب"}>
            <TextInput
              value={m.form.title}
              onChange={(v) => m.patch({ title: v })}
              placeholder={isWallet ? "مثال: کیف پول نقدی" : "مثال: کارت اصلی"}
              autoFocus
              maxLength={40}
              aria-label={isWallet ? "نام کیف‌پول" : "عنوان کارت/حساب"}
            />
          </Field>
          {isWallet ? (
            <div className="quick-chips">
              {WALLET_PRESETS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`chip ${m.form.title === w ? "active" : ""}`}
                  onClick={() => m.patch({ title: w })}
                >
                  {w}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {!isWallet ? (
          <>
            <div className="form-row full">
              <Field label="شماره کارت">
                <div className="account-card-input">
                  <TextInput
                    value={m.form.cardNo}
                    onChange={m.setCardNo}
                    type={cardVisible ? "text" : "password"}
                    autoComplete="off"
                    placeholder="۶۲۱۹ ۸۶۱۰ …"
                    dir="ltr"
                    inputMode="numeric"
                    aria-label="شماره کارت"
                  />
                  {editing ? <button type="button" className="account-reveal-button"
                    aria-label={cardVisible ? "پنهان‌کردن شماره کارت" : "نمایش شماره کارت"}
                    aria-pressed={cardVisible} onClick={() => m.toggleReveal(editing.id)}>
                    <Icon name={cardVisible ? "i-eye-off" : "i-eye"} />
                    <span>{cardVisible ? "پنهان‌کردن" : "نمایش"}</span>
                  </button> : null}
                </div>
              </Field>
            </div>
            <div className="form-row full">
              <Field label="بانک">
                <Select
                  value={m.form.bank}
                  onChange={(v) => m.patch({ bank: v })}
                  aria-label="بانک"
                  options={[
                    { value: "", label: "انتخاب کنید" },
                    ...(m.form.bank && !BANK_OPTIONS.some(bank => bank.value === m.form.bank)
                      ? [{ value: m.form.bank, label: bankDisplayLabel(m.form.bank) }] : []),
                    ...BANK_OPTIONS,
                  ]}
                />
              </Field>
            </div>

            {m.binError ? (
              <p className="field-error full" style={{ gridColumn: "1 / -1" }}>
                {m.binError}
              </p>
            ) : null}
            <p className="modal-sub full" style={{ gridColumn: "1 / -1" }}>
              کارت ۱۶ رقمی الزامی است — بانک خودکار تشخیص داده می‌شود.
            </p>
          </>
        ) : null}

        {!editing ? <div className="form-row full">
          <div className="form-row">
            <label htmlFor={balanceId}>موجودی اولیه (اختیاری)</label>
            <div className="amt-field">
              <input
                id={balanceId}
                ref={amountRef}
                type="text"
                className="num-input"
                inputMode="numeric"
                dir="ltr"
                placeholder="۰"
                value={m.form.balance}
                onChange={amountChanged}
                onKeyDown={amountKeyDown}
              />
              <InputCurrencyUnit value={m.form.balance} currency={m.entryCurrency} disabled={m.locked} onChange={(balance, currency) => { m.patch({ balance }); m.setEntryCurrency(currency); }} />
            </div>
          </div>
        </div> : <p className="modal-sub full">این فرم فقط اطلاعات حساب را تغییر می‌دهد. برای تغییر موجودی، دکمهٔ «اصلاح موجودی» روی کارت را بزنید.</p>}

        {/* هشدار ویرایش دستی موجودی */}
        {m.cardChanged ? <label className="bal-warn-ack full">
          <input type="checkbox" checked={m.cardChangeAck} onChange={event => m.setCardChangeAck(event.target.checked)} />
          <span>تغییر شماره کارت این حساب را بررسی و تأیید می‌کنم</span>
        </label> : null}

      </fieldset>

      {m.notice !== null ? <p className="field-error account-save-notice" role="status">{m.notice}</p> : null}

      {editing ? <div className="account-edit-tools">
        <button type="button" className="account-delete-button" disabled={m.locked}
          aria-label={`حذف ${editing.title}`} onClick={() => m.remove(editing)}>
          <Icon name="i-trash" />
          <span>{isWallet ? "حذف کیف پول" : "حذف حساب"}</span>
        </button>
      </div> : null}

      <div className="modal-actions">
        <button className="btn-secondary" disabled={m.locked} onClick={m.close}>
          انصراف
        </button>
        <button
          className="btn-primary"
          disabled={
            m.locked || (m.cardChanged && !m.cardChangeAck)
          }
          onClick={m.save}
        >
          {m.busy ? "در حال ذخیره…" : "ذخیره"}
        </button>
      </div>
    </Modal>
  );
}
