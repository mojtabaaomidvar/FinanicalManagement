/* DatePicker جلالی — تقویم ماهانه بدون وابستگی (هم‌سبک برند)
   نمایش با Portal؛ ناوبری ماه/سال؛ امروز هایلایت؛ انتخاب یک‌لمسی */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MONTHS,
  daysInMonth,
  formatISO,
  toGregorian,
  nextMonth,
  parse,
  prevMonth,
  today,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";

export function JalaliDatePicker({
  value,
  onChange,
  onClose,
  minYear,
  maxYear,
  title,
}: {
  /** مقدار فعلی — رشته نمایشی مثل "۱۴۰۴/۰۶/۱۵" */
  value: string;
  onChange: (displayValue: string) => void;
  onClose: () => void;
  minYear?: number;
  maxYear?: number;
  title?: string;
}) {
  const [jy, setJy] = useState(() => {
    const p = parse(value);
    return p ? p[0] : today()[0];
  });
  const [jm, setJm] = useState(() => {
    const p = parse(value);
    return p ? p[1] : today()[1];
  });
  const [yearPicker, setYearPicker] = useState(false);

  const selected = useMemo(() => parse(value), [value]);
  const [ty, tm] = today();
  const min = minYear ?? 1300;
  const max = maxYear ?? ty + 1;

  /* کلیک بیرون → بستن */
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [onClose]);

  function pick(day: number) {
    onChange(formatISO([jy, jm, day]));
    onClose();
  }

  const days = daysInMonth(jy, jm);
  /* شروع ماه چه روز هفته‌ای است؟ (getDay: 0=یکشنبه) — ستون اول تقویم فارسی = شنبه */
  const [gy, gm, gd] = toGregorian(jy, jm, 1);
  const pad = (new Date(gy, gm - 1, gd).getDay() + 1) % 7;

  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return createPortal(
    <div className="dp-overlay">
      <div className="dp-box" ref={boxRef}>
        <div className="dp-head">
          <button
            type="button"
            className="icon-btn small"
            aria-label="ماه قبل"
            onClick={() => {
              if (jy <= min && jm === 1) return;
              const [y, m] = prevMonth(jy, jm);
              setJy(y);
              setJm(m);
            }}
          >
            <svg>
              <use href="#i-arrow-r" />
            </svg>
          </button>
          <button
            type="button"
            className="dp-title"
            onClick={() => setYearPicker((v) => !v)}
          >
            {title ? <span className="dp-app-title">{title}</span> : null}
            {MONTHS[jm - 1]} {toFa(jy)}
            <svg className="dp-title-caret">
              <use href="#i-arrow-l" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn small"
            aria-label="ماه بعد"
            onClick={() => {
              if (jy >= max && jm === 12) return;
              const [y, m] = nextMonth(jy, jm);
              setJy(y);
              setJm(m);
            }}
          >
            <svg>
              <use href="#i-arrow-l" />
            </svg>
          </button>
        </div>

        {yearPicker ? (
          <div className="dp-years">
            {Array.from({ length: max - min + 1 }, (_, i) => max - i).map(
              (y) => (
                <button
                  key={y}
                  type="button"
                  className={`chip ${y === jy ? "active" : ""}`}
                  onClick={() => {
                    setJy(y);
                    setYearPicker(false);
                  }}
                >
                  {toFa(y)}
                </button>
              ),
            )}
          </div>
        ) : (
          <div className="dp-grid">
            {weekDays.map((w, i) => (
              <span key={`w${i}`} className="dp-wd">
                {w}
              </span>
            ))}
            {Array.from({ length: pad }, (_, i) => (
              <span key={`p${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
              const isToday = jy === ty && jm === tm && d === today()[2];
              const isSelected =
                !!selected &&
                selected[0] === jy &&
                selected[1] === jm &&
                selected[2] === d;
              return (
                <button
                  key={d}
                  type="button"
                  className={`dp-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                  onClick={() => pick(d)}
                >
                  {toFa(d)}
                </button>
              );
            })}
          </div>
        )}

        <div className="dp-foot">
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              onChange(formatISO(today()));
              onClose();
            }}
          >
            امروز
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
