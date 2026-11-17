import type { Goal, GoalInput } from "./goal.types";

export function isGoalDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

export function goalError(input: GoalInput): string {
  if (input.kind !== "goal" && input.kind !== "wish") return "نوع مورد را انتخاب کنید.";
  if (!input.title.trim()) return "عنوان را بنویسید.";
  if (input.title.trim().length > 120) return "عنوان باید حداکثر ۱۲۰ نویسه باشد.";
  if ((input.note?.trim().length ?? 0) > 2000) return "توضیح باید حداکثر ۲۰۰۰ نویسه باشد.";
  if (input.targetDate && !isGoalDay(input.targetDate)) return "موعد را دوباره انتخاب کنید.";
  if (input.status !== "active" && input.status !== "done") return "وضعیت مورد را انتخاب کنید.";
  if (typeof input.reminderEnabled !== "boolean") return "تنظیم یادآور معتبر نیست.";
  return "";
}

/** Status changes preserve every other editable field and the existing reminder. */
export function goalInput(goal: Goal): GoalInput {
  return { kind: goal.kind, title: goal.title, note: goal.note, targetDate: goal.targetDate,
    status: goal.status, reminderEnabled: goal.reminderEnabled };
}
