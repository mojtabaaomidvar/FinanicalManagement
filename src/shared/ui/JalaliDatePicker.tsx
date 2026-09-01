/* DatePicker جلالی — تقویم ماهانه بدون وابستگی (هم‌سبک برند)
   ناوبری: دکمه ماه قبل/بعد + انتخابگر سال چیپی؛ امروز هایلایت */

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
}: {
  /** مقدار فعلی — رشته نمایشی مثل "۱۴۰۴/۰۶/۱۵" */
  value: string;
  onChange: (displayValue: string) => void;
  onClose: () => void;
  minYear?: number;
  maxYear?: number;
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
  const [ty, tm, td] = today();
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

  function goPrevMonth() {
    if (jy <= min && jm === 1) return;
    const [y, m] = prevMonth(jy, jm);
    setJy(y);
    setJm(m);
    setYearPicker(false);
  }

  function goNextMonth() {
    if (jy >= max && jm === 12) return;
    const [y, m] = nextMonth(jy, jm);
    setJy(y);
    setJm(m);
    setYearPicker(false);
  }

  const days = daysInMonth(jy, jm);
  /* شروع ماه چه روز هفته‌ای است؟ (getDay: 0=یکشنبه) — ستون اول تقویم فارسی = شنبه */
  const [gy, gm, gd] = toGregorian(jy, jm, 1);
  const pad = (new Date(gy, gm - 1, gd).getDay() + 1) % 7;

  /* ۵ ردیف = ۳۵ خانه ثابت:
     ردیف اول با روزهای آخر ماه قبل پر می‌شود؛
     خانه‌های باقی‌مانده ردیف ۵ با روزهای اول ماه بعد (انتخاب بین‌ماهی فعال) */
  const totalCells = 35;
  const [pjy, pjm] = prevMonth(jy, jm);
  const [njy, njm] = nextMonth(jy, jm);
  const prevDays = daysInMonth(pjy, pjm);

  const cells: {
    day: number;
    month: "prev" | "cur" | "next";
    y: number;
    m: number;
  }[] = [];

  for (let i = pad - 1; i >= 0 && pad > 0; i--) {
    cells.push({ day: prevDays - i, month: "prev", y: pjy, m: pjm });
  }
  for (let d = 1; d <= days; d++) {
    cells.push({ day: d, month: "cur", y: jy, m: jm });
  }
  let nextDay = 1;
  while (cells.length < totalCells) {
    cells.push({ day: nextDay, month: "next", y: njy, m: njm });
    nextDay++;
  }
  if (cells.length > totalCells) cells.length = totalCells;

  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return createPortal(
    <div className="dp-overlay">
      <div className="dp-box" ref={boxRef}>
        <div className="dp-head">
          <button
            type="button"
            className="icon-btn small"
            aria-label="ماه قبل"
            onClick={goPrevMonth}
          >
            <svg>
              <use href="#i-arrow-r" />
            </svg>
          </button>

          {/* عنوان: ماه قابل تغییر با کلیک چپ/راست روی نام؛ سال → انتخابگر */}
          <div className="dp-title-group">
            <button
              type="button"
              className="dp-month-nav"
              aria-label="ماه قبلی"
              onClick={goPrevMonth}
            >
              <svg>
                <use href="#i-arrow-r" />
              </svg>
            </button>
            <span className="dp-month-name">{MONTHS[jm - 1]}</span>
            <button
              type="button"
              className="dp-month-nav"
              aria-label="ماه بعدی"
              onClick={goNextMonth}
            >
              <svg>
                <use href="#i-arrow-l" />
              </svg>
            </button>
            <button
              type="button"
              className={`dp-year-btn ${yearPicker ? "active" : ""}`}
              onClick={() => setYearPicker((v) => !v)}
            >
              {toFa(jy)}
              <svg className="dp-title-caret">
                <use href="#i-arrow-l" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            className="icon-btn small"
            aria-label="ماه بعد"
            onClick={goNextMonth}
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
            {cells.map((c, idx) => {
              const isToday =
                c.y === ty && c.m === tm && c.day === td;
              const isSelected =
                !!selected &&
                selected[0] === c.y &&
                selected[1] === c.m &&
                selected[2] === c.day;
              return (
                <button
                  key={`${c.m}-${c.day}-${idx}`}
                  type="button"
                  className={`dp-day ${c.month !== "cur" ? "dim" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                  onClick={() => {
                    onChange(formatISO([c.y, c.m, c.day]));
                    onClose();
                  }}
                >
                  {toFa(c.day)}
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
