/* فرم افزودن و ویرایش کارت/کیف‌پول — یک مودال برای هر دو حالت.
   فیلد ویرایش، موجودی فعلی است؛ تفاوت با تراکنش اصلاحی ثبت می‌شود. */

import { useId, useLayoutEffect, useRef, type ChangeEvent, type KeyboardEvent } from "react";

import {
  Field,
  Modal,
  Segmented,
  Select,
  TextInput,
  expressionInputCaret,
  normalizeExpressionInput,
} from "@/shared/ui";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatAccountAmount } from "@/shared/lib/format";
import { BANK_OPTIONS, bankDisplayLabel } from "@/shared/lib/banks";
import { isSmsReaderAvailable } from "@/shared/native/smsReader";
import type { AccountKind } from "@/domain/account/account.types";
import type { AccountsModel } from "../model/useAccountsModel";
import { WALLET_PRESETS } from "../model/useAccountsModel";

export function AccountFormFeature({ m }: { m: AccountsModel }) {
  /* آیا خواندن خودکار پیامک روی این دستگاه ممکن است؟ روی وب/iOS نه — و متن
     زیر کلید هم باید همین را بگوید (§۴)، وگرنه چیزی وعده داده می‌شود که
     خانه‌یار نمی‌تواند انجام دهد. عمداً داخل بدنه‌ی کامپوننت صدا زده می‌شود
     نه در سطح ماژول: اگر چانک قبل از آماده‌شدن پلِ کپاسیتور اجرا شود،
     getPlatform هنوز «web» می‌گوید و جوابِ غلط تا پایان عمرِ صفحه می‌ماند
     (همین قاعده در useNativeSmsReader هم رعایت شده). */
  const smsNative = isSmsReaderAvailable();
  const editing = m.editing;
  const kind = m.form.kind;
  const isWallet = kind === "wallet";
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
    <Modal open={m.open} onClose={m.close} title={title} sheetClassName="account-form-sheet">
      <fieldset className="account-fields form-grid" disabled={m.locked} aria-busy={m.locked} style={{ marginTop: 8 }}>
        {/* نوع حساب فقط هنگام ساخت انتخاب می‌شود — تغییرش بعداً معنا ندارد
            (کیف‌پول شماره کارت ندارد و حساب بانکی بدون کارت نمی‌ماند) */}
        {editing ? null : (
          <div className="form-row full">
            <Field label="نوع">
              <Segmented
                value={kind}
                onChange={(v) => m.patch({ kind: v as AccountKind })}
                options={[
                  { value: "bank", label: "حساب بانکی" },
                  { value: "wallet", label: "کیف‌پول" },
                ]}
              />
            </Field>
          </div>
        )}

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
          {isWallet && !editing ? (
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
            <div className="form-row">
              <Field label="شماره کارت">
                <TextInput
                  value={m.form.cardNo}
                  onChange={m.setCardNo}
                  placeholder="۶۲۱۹ ۸۶۱۰ …"
                  dir="ltr"
                  inputMode="numeric"
                  aria-label="شماره کارت"
                />
              </Field>
            </div>
            <div className="form-row">
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

        <div className="form-row full">
          <div className="form-row">
            <label htmlFor={balanceId}>{editing ? "موجودی فعلی" : "موجودی اولیه (اختیاری)"}</label>
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
              <span className="cur-suffix">{currencyDisplayLabel(m.cur)}</span>
            </div>
          </div>
          {/* ورودی مبلغ فقط رقم می‌پذیرد، پس علامت را جدا می‌گیریم؛
              بدون این، موجودی منفی هنگام ویرایش مثبت می‌شد. */}
          {editing ? (
            <label className="bal-sign">
              <input
                type="checkbox"
                checked={m.form.negative}
                onChange={(e) => m.setNegative(e.target.checked)}
              />
              <span>موجودی منفی است (بدهکار)</span>
            </label>
          ) : null}
        </div>

        {/* هشدار ویرایش دستی موجودی */}
        {m.cardChanged ? <label className="bal-warn-ack full">
          <input type="checkbox" checked={m.cardChangeAck} onChange={event => m.setCardChangeAck(event.target.checked)} />
          <span>تغییر شماره کارت این حساب را بررسی و تأیید می‌کنم</span>
        </label> : null}
        {editing && m.balanceChanged ? (
          <div className="bal-warn" style={{ gridColumn: "1 / -1" }}>
            <div className="bal-warn-head">
              <svg>
                <use href="#i-alert" />
              </svg>
              <b>این یک درآمد یا هزینهٔ واقعی نیست</b>
            </div>
            <p>
              تفاوت با عنوان «تغییر دستی موجودی» ثبت می‌شود و در گزارش‌ها دیده
              می‌شود. درآمد یا هزینهٔ واقعی را با تراکنش عادی ثبت کنید.
            </p>
            <p className="account-reviewed-balance">
              <span>موجودی ثبت‌شده:</span>{" "}
              <b dir="ltr">{formatAccountAmount(m.editingBalance, m.cur)}</b>{" "}
              <span>{currencyDisplayLabel(m.cur)}</span>
            </p>
            <label className="bal-warn-ack">
              <input
                type="checkbox"
                checked={m.balanceAck}
                onChange={(e) => m.setBalanceAck(e.target.checked)}
              />
              <span>می‌دانم و تأیید می‌کنم</span>
            </label>
          </div>
        ) : null}

        {/* کلید تشخیص از پیامک — فقط برای حساب بانکیِ موجود.
            کیف‌پول معنا ندارد (§۵) و حساب تازه هنوز شناسه ندارد، پس رضایت
            کاربر نباید عارضه‌ی جانبیِ ساختن حساب شود. */}
        {editing !== null && !isWallet ? (
          <div className="sms-opt" style={{ gridColumn: "1 / -1" }}>
            <span className="sms-opt-body">
              <b>تشخیص تراکنش از پیامک</b>
              <span>
                {smsNative
                  ? "پیامک‌های همین حساب خوانده می‌شود و خانه‌یار تراکنش را پیشنهاد می‌دهد."
                  : "خواندن خودکار پیامک فقط در اپ اندروید ممکن است؛ در نسخهٔ وب متن پیامک را خودتان جای‌گذاری می‌کنید و خانه‌یار تراکنش را پیشنهاد می‌دهد."}{" "}
                هیچ تراکنشی بدون تأیید شما ثبت نمی‌شود. تغییر این کلید بی‌درنگ
                ذخیره می‌شود و «انصراف» آن را برنمی‌گرداند.
              </span>
            </span>
            <label className="switch">
              <input
                type="checkbox"
                checked={m.smsOn}
                disabled={m.locked}
                aria-label="تشخیص تراکنش از پیامک"
                onChange={(e) => m.toggleSms(e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
        ) : null}
      </fieldset>

      {m.notice !== null ? <p className="field-error account-save-notice" role="status">{m.notice}</p> : null}

      <div className="modal-actions">
        <button className="btn-secondary" disabled={m.locked} onClick={m.close}>
          انصراف
        </button>
        <button
          className="btn-primary"
          disabled={
            m.locked || (editing !== null && m.balanceChanged && !m.balanceAck) || (m.cardChanged && !m.cardChangeAck)
          }
          onClick={m.save}
        >
          {m.busy ? "در حال ذخیره…" : "ذخیره"}
        </button>
      </div>
    </Modal>
  );
}
