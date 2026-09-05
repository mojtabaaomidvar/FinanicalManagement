import { describe, expect, it } from "vitest";
import {
  toJalali,
  toGregorian,
  daysInMonth,
  daysLeftInMonth,
  isLeap,
  parse,
  jalaliToIso,
  isoToJalali,
  formatISO,
} from "./jalali";

describe("jalali — تبدیل رفت‌وبرگشت", () => {
  it("۱۴۰۴/۰۶/۱۵ ↔ 2025-09-06", () => {
    expect(toJalali(2025, 9, 6)).toEqual([1404, 6, 15]);
    expect(toGregorian(1404, 6, 15)).toEqual([2025, 9, 6]);
  });

  it("نوروز ۱۴۰۴ = 2025-03-21", () => {
    expect(toGregorian(1404, 1, 1)).toEqual([2025, 3, 21]);
    expect(toJalali(2025, 3, 21)).toEqual([1404, 1, 1]);
  });

  it("سال کبیسه ۱۴۰۳ اسفند ۳۰ روز", () => {
    expect(isLeap(1403)).toBe(true);
    expect(daysInMonth(1403, 12)).toBe(30);
    expect(daysInMonth(1404, 12)).toBe(29);
  });

  it("parse — فارسی و انگلیسی", () => {
    expect(parse("۱۴۰۴/۰۶/۱۵")).toEqual([1404, 6, 15]);
    expect(parse("1404/6/15")).toEqual([1404, 6, 15]);
    expect(parse("1404-06-15")).toEqual([1404, 6, 15]);
    /* ماه ۱–۶ = ۳۱ روز؛ پس ۳۱/۰۶ معتبر است */
    expect(parse("1404/06/31")).toEqual([1404, 6, 31]);
    /* نامعتبر */
    expect(parse("1404/13/01")).toBeNull();
    expect(parse("1404/07/31")).toBeNull(); /* مهر ۳۰ روزه */
    expect(parse("1404/12/30")).toBeNull(); /* ۱۴۰۴ کبیسه نیست */
    expect(parse("1404/06/0")).toBeNull();
  });

  it("ISO ↔ جلالی", () => {
    expect(jalaliToIso([1404, 6, 15])).toBe("2025-09-06");
    expect(isoToJalali("2025-09-06")).toEqual([1404, 6, 15]);
  });

  it("formatISO — ارقام فارسی با صفر", () => {
    expect(formatISO([1404, 6, 5])).toBe("۱۴۰۴/۰۶/۰۵");
  });

  it("روزهای مانده تا پایان ماه — شامل خودِ روز", () => {
    expect(daysLeftInMonth([1404, 6, 1])).toBe(31); /* شهریور ۳۱ روزه */
    expect(daysLeftInMonth([1404, 6, 31])).toBe(1);
    expect(daysLeftInMonth([1404, 7, 25])).toBe(6); /* مهر ۳۰ روزه */
    expect(daysLeftInMonth([1404, 12, 29])).toBe(1); /* ۱۴۰۴ کبیسه نیست */
  });
});
