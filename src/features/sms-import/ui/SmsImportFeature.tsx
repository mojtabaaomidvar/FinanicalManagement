/* UI مودال ورود پیامک بانکی */

import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useSmsImportModel } from "../model/useSmsImportModel";
import { Modal } from "@/shared/ui";
import { formatAmount } from "@/shared/lib/format";
import { formatISO } from "@/shared/lib/jalali";
import { toDisplay } from "@/shared/lib/currency";

export function SmsImportFeature({
  onImported,
  variant = "icon",
}: {
  onImported: () => void | Promise<void>;
  /** icon = دکمه گرد هدر · chip = میان‌بُر متنی (بازنشسته) · row = ردیف داخل شیت تراکنش */
  variant?: "icon" | "chip" | "row";
}) {
  const { useCases, family } = useApp();
  const cur = family?.currency ?? "تومان";
  const { show } = useToast();
  const m = useSmsImportModel(useCases!, show);

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
            <small>متن پیامک را بچسبانید تا خودکار ثبت شود</small>
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

        <div className="form-row">
          <label>متن پیامک‌ها</label>
          <textarea
            className="text-input sms-textarea"
            rows={5}
            placeholder="متن پیامک بانک ..."
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
                    {formatAmount(toDisplay(x.p.amount!, cur))}
                    <span className="cur-tag">{cur}</span>
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
          <button className="btn-secondary" onClick={() => m.setOpen(false)}>
            انصراف
          </button>
          <button
            className="btn-primary"
            disabled={m.busy}
            onClick={() => m.save(onImported)}
          >
            افزودن پیامک‌ها
          </button>
        </div>
      </Modal>
    </>
  );
}
