import { describe, expect, it } from "vitest";
import { isoToJalali } from "@/shared/lib/jalali";
import { MEAL_TYPES, mealWeekDays, mealWeekStart, shiftMealWeek } from "./mealPresentation";

describe("Saturday to Friday meal planning", () => {
  it("places every day of the same week under its Saturday", () => {
    const days = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    expect(days.map(mealWeekStart)).toEqual(Array(7).fill("2026-11-14"));
    expect(mealWeekDays("2026-11-14")).toEqual(days);
    expect(mealWeekStart("2026-11-21")).toBe("2026-11-21");
    expect(MEAL_TYPES.map((row) => row.value)).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });

  it("crosses the Jalali year without dropping the last Friday or Nowruz Saturday", () => {
    expect(mealWeekStart("2026-03-20")).toBe("2026-03-14");
    expect(mealWeekDays("2026-03-14").at(-1)).toBe("2026-03-20");
    expect(shiftMealWeek("2026-03-14", 1)).toBe("2026-03-21");
    expect(isoToJalali(shiftMealWeek("2026-03-14", 1))).toEqual([1405, 1, 1]);
    expect(shiftMealWeek("2026-03-21", -1)).toBe("2026-03-14");
  });

  it("keeps seven calendar days across Gregorian year and leap-day boundaries", () => {
    for (const date of ["2026-12-31", "2027-01-01", "2024-02-29"]) {
      const start = mealWeekStart(date);
      const expected = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(`${start}T12:00:00Z`);
        day.setUTCDate(day.getUTCDate() + index);
        return day.toISOString().slice(0, 10);
      });
      expect(mealWeekDays(start)).toEqual(expected);
      expect(expected).toContain(date);
      expect(shiftMealWeek(shiftMealWeek(start, 1), -1)).toBe(start);
    }
  });
});
