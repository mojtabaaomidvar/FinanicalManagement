/* تستِ روزِ هفتهٔ جلالی — قفلِ رگرسیونِ یک باگِ واقعی.

   پیش از ۱۴۰۵/۰۷/۱۹ خروجیِ خامِ `Date.getDay()` (که صفرش یکشنبه است)
   مستقیم روی آرایهٔ `WEEKDAYS` (که صفرش شنبه است) اندیس می‌خورد، پس نامِ
   هر روز **یکی عقب‌تر** نوشته می‌شد. سه جا دیده می‌شد: سرستونِ صفحهٔ
   خرج‌و‌درآمد، گروه‌های تاریخ در فهرستِ تراکنش، و محورِ نمودارِ هفتگی.

   این فایل آن را قفل می‌کند. اگر کسی روزی `weekdayIndex` را «ساده» کرد و
   تبدیلِ `(getDay() + 1) % 7` را برداشت، همین‌جا قرمز می‌شود. */

import { describe, expect, it } from "vitest";
import {
  WEEKDAYS,
  WEEKDAYS_SHORT,
  formatWeekday,
  isoToJalali,
  shortWeekday,
  weekdayIndex,
} from "./jalali";

/** روزِ هفتهٔ میلادیِ همان تاریخ، مستقل از کدِ ما (مرجعِ بیرونی). */
function realWeekdayIndex(iso: string): number {
  /* نیمروزِ UTC تا منطقهٔ زمانیِ اجراکنندهٔ تست روز را جابه‌جا نکند */
  const g = new Date(`${iso}T12:00:00Z`);
  /* getUTCDay: ۰=یکشنبه → اندیسِ ایرانی: شنبه=۰ */
  return (g.getUTCDay() + 1) % 7;
}

/* یک هفتهٔ کاملِ پیوسته — تنها راهِ گرفتنِ خطای «یکی جابه‌جا» این است که
   هر هفت روز با هم سنجیده شوند؛ یک تاریخِ تنها می‌تواند تصادفی درست باشد. */
const FULL_WEEK = [
  "2026-10-10", // شنبه
  "2026-10-11",
  "2026-10-12",
  "2026-10-13",
  "2026-10-14",
  "2026-10-15",
  "2026-10-16", // جمعه
];

/* تاریخ‌های مرزی: پایان/آغازِ سالِ جلالی، پایان/آغازِ سالِ میلادی، سالِ کبیسه */
const EDGES = [
  "2026-03-20", // ۱۴۰۴/۱۲/۲۹ — آخرین روزِ سال
  "2026-03-21", // ۱۴۰۵/۰۱/۰۱ — نوروز
  "2026-12-31",
  "2027-01-01",
  "2024-02-29", // کبیسهٔ میلادی
];

describe("روزِ هفتهٔ جلالی", () => {
  it("هفتهٔ کامل: شنبه تا جمعه درست نام می‌گیرد", () => {
    const got = FULL_WEEK.map((iso) => WEEKDAYS[weekdayIndex(isoToJalali(iso))]);
    expect(got).toEqual([
      "شنبه",
      "یکشنبه",
      "دوشنبه",
      "سه‌شنبه",
      "چهارشنبه",
      "پنجشنبه",
      "جمعه",
    ]);
  });

  it("با مرجعِ بیرونی هم‌خوان است (هفته + مرزها)", () => {
    for (const iso of [...FULL_WEEK, ...EDGES]) {
      expect(weekdayIndex(isoToJalali(iso))).toBe(realWeekdayIndex(iso));
    }
  });

  it("formatWeekday و shortWeekday از همان اندیس می‌خوانند", () => {
    for (const iso of [...FULL_WEEK, ...EDGES]) {
      const jd = isoToJalali(iso);
      const i = realWeekdayIndex(iso);
      expect(formatWeekday(jd).split(" ")[0]).toBe(WEEKDAYS[i]);
      expect(shortWeekday(jd)).toBe(WEEKDAYS_SHORT[i]);
    }
  });

  it("اندیس همیشه در بازهٔ ۰ تا ۶ است", () => {
    /* ۴۰۰ روزِ پیوسته — هم چند مرزِ ماه را می‌گیرد هم یک مرزِ سال */
    const start = new Date("2026-01-01T12:00:00Z");
    for (let n = 0; n < 400; n++) {
      const d = new Date(start.getTime() + n * 86400000);
      const iso = d.toISOString().slice(0, 10);
      const i = weekdayIndex(isoToJalali(iso));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(6);
      expect(i).toBe(realWeekdayIndex(iso));
    }
  });
});
