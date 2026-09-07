/* فرم افزودن و ویرایش کارت/کیف‌پول — یک مودال برای هر دو حالت.
   نکته‌ی مهم ویرایش: فیلد موجودی «موجودی فعلی» است، نه اولیه. تغییرش
   هیچ تراکنش درآمد/هزینه‌ای نمی‌سازد، پس هشدار برجسته + تأیید صریح دارد. */

import {
  AmountInput,
  Field,
  Modal,
  Segmented,
  Select,
  TextInput,
} from "@/shared/ui";
import { BANK_NAMES } from "@/shared/lib/banks";
import type { AccountKind } from "@/domain/account/account.types";
import type { AccountsModel } from "../model/useAccountsModel";
import { WALLET_PRESETS } from "../model/useAccountsModel";

export function AccountFormFeature({ m }: { m: AccountsModel }) {
  const editing = m.editing;
  const kind = m.form.kind;
  const isWallet = kind === "wallet";

  const title = editing
    ? isWallet
      ? "ویرایش کیف‌پول"
      : "ویرایش حساب بانکی"
    : isWallet
      ? "کیف‌پول جدید"
      : "حساب بانکی جدید";

  return (
    <Modal open={m.open} onClose={m.close} title={title}>
      <div className="form-grid" style={{ marginTop: 8 }}>
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

        <div className="form-row full">
          <Field label={isWallet ? "نام کیف‌پول" : "عنوان کارت/حساب"}>
            <TextInput
              value={m.form.title}
              onChange={(v) => m.patch({ title: v })}
              placeholder={
                isWallet ? "مثال: کیف پول نقدی" : "مثال: کارت اصلی"
              }
              autoFocus
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
                />
              </Field>
            </div>
            <div className="form-row">
              <Field label="بانک">
                <Select
                  value={m.form.bank}
                  onChange={(v) => m.patch({ bank: v })}
                  options={[
                    { value: "", label: "انتخاب کنید" },
                    ...BANK_NAMES.map((b) => ({ value: b, label: b })),
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
          <Field label={editing ? "موجودی فعلی" : "موجودی اولیه (اختیاری)"}>
            <AmountInput
              value={m.form.balance}
              onChange={(v) => m.patch({ balance: v })}
              currency={m.cur}
            />
          </Field>
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
        {editing && m.balanceChanged ? (
          <div className="bal-warn" style={{ gridColumn: "1 / -1" }}>
            <div className="bal-warn-head">
              <svg>
                <use href="#i-alert" />
              </svg>
              <b>این یک درآمد یا هزینهٔ واقعی نیست</b>
            </div>
            <p>
              موجودی به‌صورت دستی اصلاح می‌شود. برای شفاف‌ماندنِ حساب، تفاوت
              به‌صورت یک تراکنش با عنوان «تغییر دستی موجودی» به تاریخ و ساعت
              همین لحظه ثبت می‌شود؛ ولی این پول واقعاً خرج یا کسب نشده. اگر
              درآمد یا هزینهٔ واقعی دارید، به‌جای این کار یک تراکنش عادی ثبت
              کنید.
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
      </div>

      <div className="modal-actions">
        <button className="btn-secondary" onClick={m.close}>
          انصراف
        </button>
        <button
          className="btn-primary"
          disabled={
            m.busy || (editing !== null && m.balanceChanged && !m.balanceAck)
          }
          onClick={m.save}
        >
          ذخیره
        </button>
      </div>
    </Modal>
  );
}
