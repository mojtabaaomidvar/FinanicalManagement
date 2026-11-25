import { CurrencyUnit } from "@/shared/ui/CurrencyUnit";
/* UI مودال ورود پیامک بانکی */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useSmsImportModel } from "../model/useSmsImportModel";
import { Modal } from "@/shared/ui";
import { formatAmount, formatAccountAmount } from "@/shared/lib/format";
import { formatISO } from "@/shared/lib/jalali";

export function SmsImportFeature({
  onImported,
  variant = "icon",
}: {
  onImported: () => void | Promise<void>;
  /** icon = دکمه گرد هدر · chip = میان‌بُر متنی (بازنشسته) · row = ردیف داخل شیت تراکنش */
  variant?: "icon" | "chip" | "row";
}) {
  const { useCases, cur, member, family } = useApp();
  const { show } = useToast();
  const m = useSmsImportModel(useCases!, show, { familyId: family?.id ?? "", memberId: member?.id ?? "" });

  return (
    <>
      {variant === "row" ? (
        <button
          type="button"
          className="tx-sms-btn"
          onClick={() => m.setOpen(true)}
        >
          <span className="tx-sms-ico">
            <svg>
              <use href="#i-sms" />
            </svg>
          </span>
          <span className="tx-sms-text">
            <b>ثبت از پیامک بانکی</b>
            <small>متن پیامک را بچسبانید و اطلاعاتش را بررسی کنید</small>
          </span>
          <svg className="tx-sms-go">
            <use href="#i-arrow-r" />
          </svg>
        </button>
      ) : variant === "chip" ? (
        <button
          type="button"
          className="qa-chip sms"
          onClick={() => m.setOpen(true)}
        >
          <span className="qa-ico">
            <svg>
              <use href="#i-sms" />
            </svg>
          </span>
          پیامک بانکی
        </button>
      ) : (
        <button
          className="icon-btn"
          aria-label="ورود پیامک"
          onClick={() => m.setOpen(true)}
        >
          <svg>
            <use href="#i-sms" />
          </svg>
        </button>
      )}

      <Modal
        open={m.open}
        onClose={() => m.setOpen(false)}
        title="ورود پیامک بانکی"
      >
        <p className="modal-sub">
          متن پیامک واریز/برداشت را اینجا بچسبانید (Paste). می‌توانید چند پیامک
          را با خط خالی از هم جدا کنید.
        </p>

        <p className="section-hint">با بستن این پنجره متن پاک می‌شود. پیامک‌های افزوده‌شده در بخش «پیامک‌های بانکی» باقی می‌مانند.</p>
        <div className="form-row">
          <label htmlFor="sms-import-text">متن پیامک‌ها</label>
          <textarea
            id="sms-import-text"
            className="text-input sms-textarea"
            rows={5}
            placeholder="متن پیامک بانک…"
            disabled={m.busy}
            value={m.raw}
            onChange={(e) => m.setRaw(e.target.value)}
          />
        </div>

        {m.previews.length ? (
          <div className="sms-preview">
            {m.previews.map((x, i) =>
              x.ok ? (
                <div className="sms-preview-item" key={i}>
                  <span>{x.p.bank || "بانک ناشناس"}</span>
                  <b className={x.p.type!}>
                    {x.p.type === "income" ? "واریز" : "برداشت"} ·{" "}
                    {x.baseAmount == null ? formatAmount(x.p.amount!) : formatAccountAmount(x.baseAmount, cur)}
                    {x.baseAmount == null ? <span className="cur-tag">واحد نامشخص</span> : <CurrencyUnit className="cur-tag" />}
                  </b>
                  <span>
                    {x.p.date
                      ? formatISO(x.p.date.jalali as [number, number, number])
                      : "بدون تاریخ"}
                  </span>
                </div>
              ) : (
                <div className="sms-preview-item" key={i}>
                  <span>نامشخص</span>
                  <b>تشخیص داده نشد</b>
                </div>
              ),
            )}
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={m.busy} onClick={() => m.setOpen(false)}>
            انصراف
          </button>
          <button
            className="btn-primary"
            type="button"
            disabled={m.busy}
            onClick={() => m.save(onImported)}
          >
            {m.busy ? "در حال افزودن پیامک‌ها…" : "افزودن پیامک‌ها"}
          </button>
        </div>
      </Modal>
    </>
  );
}
