import type { ChildInput } from "./child.types";

export function todayTehran(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}

export function childError(input: ChildInput, currentDate = todayTehran()): string | null {
  const name = input.name.trim();
  if (!name || name.length > 40) return "نام فرزند باید بین ۱ تا ۴۰ نویسه باشد.";
  if (input.birthDate !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate)) return "تاریخ تولد معتبر را انتخاب کنید.";
    const parsed = new Date(`${input.birthDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.birthDate) return "تاریخ تولد معتبر را انتخاب کنید.";
    if (input.birthDate > currentDate) return "تاریخ تولد نمی‌تواند در آینده باشد.";
  }
  return null;
}
