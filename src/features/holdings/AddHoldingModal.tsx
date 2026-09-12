/* مودالِ افزودن/ویرایشِ دارایی از یک ردیفِ قیمت.

   کاربر «مقدار» می‌دهد نه مبلغ: «۲ سکه» همیشه ۲ سکه است ولی ارزشش هر روز
   فرق می‌کند. پیش‌نمایشِ ارزش این‌جا فقط برای اطمینانِ کاربر است و هیچ‌وقت
   ذخیره نمی‌شود؛ سرور ارزش را از قیمتِ روزِ خودش حساب می‌کند.

   یک مودال برای هر دو کار (افزودن و ویرایش) است چون فرم‌شان دقیقاً یکی است:
   نماد و نوع تغییرناپذیرند و تنها فیلدِ قابلِ تغییر «مقدار» است. اگر کاربر
   نمادی را که قبلاً دارد دوباره بزند، ردیفِ دوم ساخته نمی‌شود بلکه همان
   ردیف ویرایش می‌شود — دارایی نه قیمتِ خرید دارد نه تاریخ، پس دو ردیفِ
   «۱ سکه» و «۲ سکه» هیچ اطلاعاتی بیش از یک ردیفِ «۳ سکه» ندارند و فقط
   فهرست را شلوغ می‌کنند. */

import { useEffect, useState } from "react";
import { Field, Modal, TextInput } from "@/shared/ui";
import { formatAmount } from "@/shared/lib/format";
import { toFa } from "@/shared/lib/digits";
import {
  KIND_UNIT,
  formatQuantity,
  liveFormatQuantity,
  parseQuantityInput,
  roundQuantity,
  validateQuantity,
} from "@/domain/holding/holding.rules";
import type { HoldingKind } from "@/domain/holding/holding.types";

/** پیامِ فارسیِ هر کدِ خطایِ قواعد — قواعد کد می‌دهند، UI جمله می‌سازد. */
const QUANTITY_ERROR: Record<string, string> = {
  INVALID_QUANTITY: "مقدار را درست وارد کنید.",
  ZERO_QUANTITY: "مقدار باید بیشتر از صفر باشد.",
  HUGE_QUANTITY: "این مقدار بیش از حدِ مجاز است.",
};

export type HoldingTarget = {
  kind: HoldingKind;
  symbol: string;
  name: string;
  /** واحدِ قیمتِ ردیفِ بازار (تومان/ریال) — فقط برای نمایش */
  unit: string;
  /** قیمتِ واحد در همان واحدِ بالا */
  price: number;
};

export function AddHoldingModal({
  target,
  existingQuantity,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  /** null = بسته. هر بار که باز می‌شود فرم از نو مقداردهی می‌شود. */
  target: HoldingTarget | null;
  /** مقدارِ فعلی اگر این نماد قبلاً ثبت شده — یعنی حالتِ ویرایش */
  existingQuantity?: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (quantity: number) => void;
}) {
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);

  const editing = existingQuantity !== undefined;

  /* با هر بار باز شدن، فرم را به مقدارِ فعلی (یا خالی) برگردان.
     بدونِ این، مقدارِ نمادِ قبلی در مودالِ نمادِ بعدی می‌ماند. */
  useEffect(() => {
    if (!target) return;
    setRaw(editing ? formatQuantity(existingQuantity) : "");
    setTouched(false);
  }, [target, editing, existingQuantity]);

  if (!target) return null;

  const quantity = roundQuantity(parseQuantityInput(raw));
  const check = validateQuantity(quantity);
  const showError = touched && !check.ok;
  /* پیش‌نمایش فقط وقتی هم مقدار معتبر است هم قیمت داریم. قیمتِ ۰ یعنی
     بالادست این قلم را نداده؛ آن‌وقت «۰ تومان» گمراه‌کننده است. */
  const preview = check.ok && target.price > 0 ? quantity * target.price : null;

  const submit = () => {
    setTouched(true);
    if (!check.ok || busy) return;
    onSubmit(quantity);
  };

  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      title={editing ? "ویرایش دارایی" : "افزودن به دارایی‌ها"}
      dragToClose
    >
      <div className="hold-target">
        <b className="hold-target-name">{target.name}</b>
        {target.price > 0 ? (
          <span className="hold-target-price" dir="ltr">
            {formatAmount(target.price)}
            <small>{target.unit}</small>
          </span>
        ) : (
          <span className="hold-target-price is-muted">قیمت در دسترس نیست</span>
        )}
      </div>

      <Field label={`مقدار (${KIND_UNIT[target.kind]})`}>
        <TextInput
          value={raw}
          onChange={(v) => {
            setRaw(liveFormatQuantity(v));
            setTouched(true);
          }}
          placeholder="۰"
          dir="ltr"
          /* decimal نه numeric: کیبوردِ numeric جداکنندهٔ اعشار ندارد و
             «۲٫۵ گرم» اصلاً قابلِ تایپ نمی‌شد. */
          inputMode="decimal"
          autoFocus
          maxLength={20}
        />
      </Field>

      {showError ? (
        <p className="field-error">
          {QUANTITY_ERROR[check.error ?? ""] ?? "مقدار را درست وارد کنید."}
        </p>
      ) : null}

      {preview !== null ? (
        <div className="hold-preview">
          <span>ارزشِ امروز</span>
          <b dir="ltr">
            {formatAmount(preview)}
            <small>{target.unit}</small>
          </b>
        </div>
      ) : null}

      {editing ? (
        <p className="section-hint">
          این نماد را قبلاً ثبت کرده‌اید؛ مقدارِ تازه جایگزینِ مقدارِ قبلی
          ({formatQuantity(existingQuantity)} {KIND_UNIT[target.kind]}) می‌شود.
        </p>
      ) : null}

      {error ? <p className="field-error">{toFa(error)}</p> : null}

      <div className="modal-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          انصراف
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={submit}
          disabled={busy}
        >
          {busy ? "در حال ذخیره…" : editing ? "ذخیره مقدار" : "افزودن"}
        </button>
      </div>
    </Modal>
  );
}
