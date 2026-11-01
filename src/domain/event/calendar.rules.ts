/* §۱.۱۰ تقویم خانواده — قواعدِ شبکهٔ ماهانهٔ جلالی.

   توابعِ **خالص**: ورودی بگیر، خانه‌های شبکه بده. نه state، نه تاریخِ
   سیستم (امروز پارامتر است)، نه DOM. همه‌شان این‌جا هستند نه داخلِ JSX،
   چون منطقِ شبکه همان‌جایی است که خطای «یکی جابه‌جا» قایم می‌شود و داخلِ
   JSX آزمون‌پذیر نیست.

   ⚠️ تلهٔ مرکزی: تعدادِ خانه‌های خالیِ ابتدای ماه. هفتهٔ ایرانی از **شنبه**
   شروع می‌شود و `weekdayIndex` (در shared/lib/jalali) اندیسِ ۰ را شنبه
   می‌دهد. پیش از ۱۴۰۵/۰۷/۱۹ آن تابع خروجیِ خامِ `Date.getDay()` را
   می‌داد که صفرش یکشنبه است — یعنی اگر شبکه را رویش می‌ساختیم، کلِ ماه
   یک خانه جابه‌جا می‌شد و هیچ‌کس زود نمی‌فهمید.

   تاریخِ ذخیره‌شدهٔ رویداد **میلادی** است (`FamilyEvent.date`)، پس هر
   مقایسه اول از `isoToJalali` می‌گذرد. برشِ رشتهٔ میلادی
   (`date.slice(0, 7)`) جایگزینِ مقایسهٔ ماه نیست: هر ماهِ میلادی روی دو
   ماهِ جلالی می‌افتد. */

import type { JDate } from "@/shared/lib/jalali";
import {
  addDays,
  cmp,
  daysInMonth,
  formatISO,
  isoToJalali,
  weekdayIndex,
} from "@/shared/lib/jalali";

/** یک خانهٔ شبکه. `day === null` یعنی خانهٔ خالیِ پیش از اولِ ماه. */
export interface CalendarCell {
  day: number | null;
  /** شناسهٔ پایدار برای key — خانه‌های خالی هم باید key یکتا داشته باشند */
  key: string;
}

/**
 * خانه‌های یک ماهِ جلالی، با خانه‌های خالیِ ابتدایی تا اولِ ماه زیرِ
 * سرستونِ درست بیفتد.
 *
 * خانهٔ خالیِ **پایانی** اضافه نمی‌شود: شبکه با CSS grid پر می‌شود و ردیفِ
 * آخرِ ناقص مشکلی ندارد. افزودنشان فقط خانه‌های بی‌معنیِ قابلِ‌کلیک می‌ساخت.
 */
export function monthCells(jy: number, jm: number): CalendarCell[] {
  const lead = weekdayIndex([jy, jm, 1]);
  const total = daysInMonth(jy, jm);
  const cells: CalendarCell[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push({ day: null, key: `pad-${jy}-${jm}-${i}` });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ day: d, key: `${jy}-${jm}-${d}` });
  }
  return cells;
}

/** نگاشتِ «روزِ ماه → تعدادِ رویداد» برای یک ماهِ جلالیِ مشخص. */
export function eventCountByDay(
  events: { date: string }[],
  jy: number,
  jm: number,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const ev of events) {
    const [y, m, d] = isoToJalali(ev.date);
    if (y !== jy || m !== jm) continue;
    out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

/** رویدادهای یک روزِ مشخص. */
export function eventsOnDay<T extends { date: string }>(
  events: T[],
  target: JDate,
): T[] {
  return events.filter((ev) => cmp(isoToJalali(ev.date), target) === 0);
}

/**
 * رویدادهای «نزدیک» — از امروز تا `days` روزِ آینده (هر دو سر بسته).
 *
 * فهرستِ ورودی از سرور از قبل مرتب آمده (آینده صعودی، بعد گذشته)، پس
 * این‌جا دوباره مرتب نمی‌شود — همان قاعدهٔ «یک مرجعِ ترتیب».
 */
export function upcomingEvents<T extends { date: string }>(
  events: T[],
  todayJ: JDate,
  days: number,
): T[] {
  const horizon = addDays(todayJ, days);
  return events.filter((ev) => {
    const when = isoToJalali(ev.date);
    return cmp(when, todayJ) >= 0 && cmp(when, horizon) <= 0;
  });
}

/** شناسهٔ روز برای مقایسه و key — نه برای نمایش. */
export function dayKey(d: JDate): string {
  return formatISO(d);
}
