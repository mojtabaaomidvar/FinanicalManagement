import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* کامپوننت‌های پایه فرم — سازگار با کلاس‌های CSS موجود */

import { useId, useState, type ChangeEvent, type ReactNode } from "react";
import { normalizeExpressionInput } from "./CalcKeypad";
import { toFa } from "@/shared/lib/digits";
import { JalaliDatePicker } from "./JalaliDatePicker";
import { InputCurrencyUnit } from "./InputCurrencyUnit";

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="form-row">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function TextInput({ "aria-label": ariaLabel, ...props }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  /* decimal برای مقدار اعشاری (دارایی): numeric در موبایل کیبورد
     بدون جداکنندهٔ اعشار می‌دهد و «۲٫۵ گرم» اصلاً قابل تایپ نمی‌شد. */
  inputMode?: "text" | "tel" | "numeric" | "decimal";
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  maxLength?: number;
  "aria-label"?: string;
}) {
  return (
    <input
      type={props.type ?? "text"}
      className={props.className ?? "text-input"}
      value={props.value}
      placeholder={props.placeholder}
      dir={props.dir}
      autoComplete={props.autoComplete}
      inputMode={props.inputMode}
      maxLength={props.maxLength}
      autoFocus={props.autoFocus}
      disabled={props.disabled}
      aria-label={ariaLabel}
      onChange={(e: ChangeEvent<HTMLInputElement>) =>
        props.onChange(e.target.value)
      }
    />
  );
}

/** ورودی مبلغ با فرمت زنده فارسی — با currency: پسوند واحد داخل فیلد */
export function AmountInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  big?: boolean;
  currency?: string;
  onCurrencyChange?: (value: string, currency: string) => void;
  disabled?: boolean;
}) {
  const input = (
    <input
      type="text"
      className={`num-input ${props.big ? "big" : ""}`}
      inputMode="decimal"
      dir="ltr"
      placeholder={props.placeholder ?? "۰"}
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(normalizeExpressionInput(e.target.value))}
    />
  );
  if (!props.currency) return input;
  return (
    <div className="amt-field">
      {input}
      {props.onCurrencyChange ? <InputCurrencyUnit value={props.value} currency={props.currency} disabled={props.disabled} onChange={props.onCurrencyChange} /> : <span className="cur-suffix">{currencyDisplayLabel(props.currency)}</span>}
    </div>
  );
}

/** ورودی تاریخ جلالی — کلیک روی فیلد → تقویم (بدون تایپ دستی)
    با onTimeChange: انتخاب ساعت هم در همان شیت انجام می‌شود */
export function JalaliDateInput({ "aria-label": ariaLabel, ...props }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** محدوده سال‌ها */
  minYear?: number;
  maxYear?: number;
  /** "HH:MM" یا "" — همراه با onTimeChange فعال می‌شود */
  time?: string;
  onTimeChange?: (t: string) => void;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const label = props.value
    ? props.time
      ? `${props.value} · ${toFa(props.time)}`
      : props.value
    : "";

  return (
    <>
      <button
        type="button"
        className="text-input date-field"
        aria-label={ariaLabel}
        aria-describedby={ariaLabel ? valueId : undefined}
        onClick={() => setOpen(true)}
      >
        <span id={valueId} className={label ? "" : "date-empty"}>
          {label || props.placeholder || "انتخاب تاریخ"}
        </span>
        <svg className="date-field-icon">
          <use href="#i-bill" />
        </svg>
      </button>
      {open ? (
        <JalaliDatePicker
          value={props.value}
          onChange={props.onChange}
          onClose={() => setOpen(false)}
          minYear={props.minYear}
          maxYear={props.maxYear}
          time={props.time}
          onTimeChange={props.onTimeChange}
        />
      ) : null}
    </>
  );
}

export function Select({ "aria-label": ariaLabel, ...props }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  className?: string;
  /** برای حالت «در حال ذخیره» — از انتخاب دوباره جلوگیری می‌کند */
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <select
      className={props.className ?? "select-input"}
      value={props.value}
      disabled={props.disabled}
      aria-label={ariaLabel}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** سگمنت دو/چندتایی */
export function Segmented<T extends string>(props: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  id?: string;
}) {
  return (
    <div className="seg-control" id={props.id}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`seg-btn ${props.value === o.value ? "active" : ""}`}
          aria-pressed={props.value === o.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
