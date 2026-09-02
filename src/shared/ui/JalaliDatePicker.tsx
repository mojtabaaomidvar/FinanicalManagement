/* DatePicker جلالی — تقویم ماهانه بدون وابستگی (هم‌سبک برند)
   عنوان «ماه سال» یکی → چرخ‌انداز iOS؛ روزها فقط همان ماه؛
   با onTimeChange: پس از انتخاب روز، ساعت در همین شیت انتخاب می‌شود */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MONTHS,
  daysInMonth,
  formatISO,
  formatLong,
  toGregorian,
  nextMonth,
  parse,
  prevMonth,
  today,
} from "@/shared/lib/jalali";
import { toFa } from "@/shared/lib/digits";
import { nowTime } from "@/shared/lib/format";
import { WheelColumn } from "./Wheel";

const pad2 = (n: number) => String(n).padStart(2, "0");

type DpView = "date" | "wheel" | "time";

export function JalaliDatePicker({
  value,
  onChange,
  onClose,
  minYear,
  maxYear,
  time,
  onTimeChange,
}: {
  /** مقدار فعلی — رشته نمایشی مثل "۱۴۰۴/۰۶/۱۵" */
  value: string;
  onChange: (displayValue: string) => void;
  onClose: () => void;
  minYear?: number;
  maxYear?: number;
  /** ساعت فعلی "HH:MM" — خالی/نال = بدون ساعت */
  time?: string | null;
  /** با دادن این پراپ، مرحله انتخاب ساعت در همان شیت فعال می‌شود */
  onTimeChange?: (t: string) => void;
}) {
  const withTime = !!onTimeChange;

  const [view, setView] = useState<DpView>("date");
  const [jy, setJy] = useState(() => {
    const p = parse(value);
    return p ? p[0] : today()[0];
  });
  const [jm, setJm] = useState(() => {
    const p = parse(value);
    return p ? p[1] : today()[1];
  });
  /* چرخ‌انداز ماه/سال */
  const [wy, setWy] = useState(jy);
  const [wm, setWm] = useState(jm);
  /* ساعت */
  const [h, setH] = useState(0);
  const [mi, setMi] = useState(0);

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
  }

  function goNextMonth() {
    if (jy >= max && jm === 12) return;
    const [y, m] = nextMonth(jy, jm);
    setJy(y);
    setJm(m);
  }

  /* مرحله ساعت — با مقدار فعلی یا زمان الان پیش‌فرض */
  function enterTime() {
    const base = time || nowTime();
    const [a, b] = base.split(":").map(Number);
    setH(Math.min(23, Math.max(0, +a || 0)));
    setMi(Math.min(59, Math.max(0, +b || 0)));
    setView("time");
  }

  function pickDay(y: number, m: number, d: number) {
    onChange(formatISO([y, m, d]));
    if (withTime) enterTime();
    else onClose();
  }

  const days = daysInMonth(jy, jm);
  /* شروع ماه چه روز هفته‌ای است؟ (getDay: 0=یکشنبه) — ستون اول تقویم فارسی = شنبه */
  const [gy, gm, gd] = toGregorian(jy, jm, 1);
  const pad = (new Date(gy, gm - 1, gd).getDay() + 1) % 7;

  /* حداکثر ۵ ردیف = ۳۵ خانه ثابت؛ روزهای اضافه به ابتدای ردیف اول می‌پیچند */
  const totalCells = 35;
  const overflow = Math.max(0, pad + days - totalCells);

  const weekDays = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return createPortal(
    <div className="dp-overlay">
      <div className="dp-box" ref={boxRef}>
        <div className="dp-head">
          {view === "date" ? (
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
          ) : view === "time" ? (
            <button
              type="button"
              className="icon-btn small"
              aria-label="بازگشت به تقویم"
              onClick={() => setView("date")}
            >
              <svg>
                <use href="#i-arrow-r" />
              </svg>
            </button>
          ) : (
            <span className="dp-head-spacer" aria-hidden="true" />
          )}

          <div className="dp-title-group">
            {view === "wheel" ? (
              <span className="dp-month-name">
                {MONTHS[wm - 1]} {toFa(wy)}
              </span>
            ) : view === "time" ? (
              <span className="dp-month-name">
                {formatLong(selected ?? today())}
              </span>
            ) : (
              <button
                type="button"
                className="dp-title-btn"
                aria-label="انتخاب ماه و سال"
                onClick={() => {
                  setWy(jy);
                  setWm(jm);
                  setView("wheel");
                }}
              >
                {MONTHS[jm - 1]} {toFa(jy)}
                <svg className="dp-title-caret">
                  <use href="#i-arrow-l" />
                </svg>
              </button>
            )}
          </div>

          {view === "date" ? (
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
          ) : (
            <span className="dp-head-spacer" aria-hidden="true" />
          )}
        </div>

        {view === "wheel" ? (
          <>
            <div className="dp-wheel">
              <WheelColumn
                items={MONTHS.map((name, i) => ({
                  value: i + 1,
                  label: name,
                }))}
                value={wm}
                onChange={setWm}
              />
              <WheelColumn
                items={Array.from({ length: max - min + 1 }, (_, i) => ({
                  value: min + i,
                  label: toFa(min + i),
                }))}
                value={wy}
                onChange={setWy}
              />
            </div>
            <div className="dp-foot time-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setView("date")}
              >
                انصراف
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setJy(wy);
                  setJm(wm);
                  setView("date");
                }}
              >
                تایید
              </button>
            </div>
          </>
        ) : view === "time" ? (
          <>
            <div className="dp-wheel" dir="ltr">
              <WheelColumn
                items={Array.from({ length: 24 }, (_, i) => ({
                  value: i,
                  label: toFa(pad2(i)),
                }))}
                value={h}
                onChange={setH}
              />
              <span className="wheel-sep" aria-hidden="true">
                :
              </span>
              <WheelColumn
                items={Array.from({ length: 60 }, (_, i) => ({
                  value: i,
                  label: toFa(pad2(i)),
                }))}
                value={mi}
                onChange={setMi}
              />
            </div>
            <div className="dp-foot time-foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  onTimeChange!("");
                  onClose();
                }}
              >
                بدون ساعت
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const [a, b] = nowTime().split(":").map(Number);
                  setH(+a);
                  setMi(+b);
                }}
              >
                الان
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  onTimeChange!(`${pad2(h)}:${pad2(mi)}`);
                  onClose();
                }}
              >
                تایید
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dp-grid">
              {weekDays.map((w, i) => (
                <span key={`w${i}`} className="dp-wd">
                  {w}
                </span>
              ))}
              {Array.from({ length: totalCells }, (_, i) => {
                /* ردیف اول: روزهای انتهای ماه که جا نشدند */
                let d: number;
                if (i < overflow) {
                  d = days - overflow + 1 + i;
                } else {
                  const dd = i - pad + 1;
                  if (dd < 1 || dd > days) {
                    return <span key={`e${i}`} className="dp-day blank" />;
                  }
                  d = dd;
                }
                const isToday = jy === ty && jm === tm && d === td;
                const isSelected =
                  !!selected &&
                  selected[0] === jy &&
                  selected[1] === jm &&
                  selected[2] === d;
                return (
                  <button
                    key={`${i < overflow ? "w" : ""}${d}`}
                    type="button"
                    className={`dp-day ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => pickDay(jy, jm, d)}
                  >
                    {toFa(d)}
                  </button>
                );
              })}
            </div>

            <div className="dp-foot">
              <button
                type="button"
                className="btn-primary btn-block"
                onClick={() => {
                  onChange(formatISO(today()));
                  if (withTime) enterTime();
                  else onClose();
                }}
              >
                امروز
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
