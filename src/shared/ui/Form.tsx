/* کامپوننت‌های پایه فرم — سازگار با کلاس‌های CSS موجود */

import { useState, type ChangeEvent, type ReactNode } from "react";
import { liveFormatAmount } from "@/shared/lib/format";
import { JalaliDatePicker } from "./JalaliDatePicker";

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

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  dir?: "ltr" | "rtl";
  autoComplete?: string;
  inputMode?: "text" | "tel" | "numeric";
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
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
      onChange={(e: ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)}
    />
  );
}

/** ورودی مبلغ با فرمت زنده فارسی */
export function AmountInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  big?: boolean;
}) {
  return (
    <input
      type="text"
      className={`num-input ${props.big ? "big" : ""}`}
      inputMode="numeric"
      placeholder={props.placeholder ?? "۰"}
      value={props.value}
      onChange={(e) => props.onChange(liveFormatAmount(e.target.value))}
    />
  );
}

/** ورودی تاریخ جلالی — کلیک روی فیلد → تقویم (بدون تایپ دستی) */
export function JalaliDateInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** محدوده سال‌ها */
  minYear?: number;
  maxYear?: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="text-input date-field"
        onClick={() => setOpen(true)}
      >
        <span className={props.value ? "" : "date-empty"}>
          {props.value || props.placeholder || "انتخاب تاریخ"}
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
        />
      ) : null}
    </>
  );
}

export function Select(props: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      className={props.className ?? "select-input"}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
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
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
