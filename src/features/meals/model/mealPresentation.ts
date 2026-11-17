import { addDays, isoToJalali, jalaliToIso, today, weekdayIndex } from "@/shared/lib/jalali";
import type { MealType } from "@/domain/meal/meal.types";

export const MEAL_TYPES: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "صبحانه" },
  { value: "lunch", label: "ناهار" },
  { value: "dinner", label: "شام" },
];

export function mealWeekStart(date = jalaliToIso(today())): string {
  const day = isoToJalali(date);
  return jalaliToIso(addDays(day, -weekdayIndex(day)));
}

export function mealWeekDays(weekStart: string): string[] {
  const start = isoToJalali(weekStart);
  return Array.from({ length: 7 }, (_, index) => jalaliToIso(addDays(start, index)));
}

export function shiftMealWeek(weekStart: string, weeks: number): string {
  return jalaliToIso(addDays(isoToJalali(weekStart), weeks * 7));
}
