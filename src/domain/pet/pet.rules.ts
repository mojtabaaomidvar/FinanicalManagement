import type { PetCareInput, PetInput } from "./pet.types";

export function petTodayTehran(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}
function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function petError(input: PetInput, currentDate = petTodayTehran()): string | null {
  if (!input.name.trim() || input.name.trim().length > 80) return "نام حیوان باید بین ۱ تا ۸۰ نویسه باشد.";
  if (!input.species.trim() || input.species.trim().length > 60) return "نوع حیوان باید بین ۱ تا ۶۰ نویسه باشد.";
  if ((input.breed?.trim().length ?? 0) > 100) return "نژاد باید حداکثر ۱۰۰ نویسه باشد.";
  if (input.birthDate !== null) {
    if (!validDay(input.birthDate)) return "تاریخ تولد معتبر را انتخاب کنید.";
    if (input.birthDate > currentDate) return "تاریخ تولد نمی‌تواند در آینده باشد.";
  }
  return null;
}
export function petCareError(input: PetCareInput, assigneeIds: readonly string[]): string | null {
  if (!input.title.trim() || input.title.trim().length > 120) return "عنوان کار مراقبتی باید بین ۱ تا ۱۲۰ نویسه باشد.";
  if (input.assigneeId !== null && !assigneeIds.includes(input.assigneeId)) return "مسئول کار را از اعضای فعال خانواده انتخاب کنید.";
  if (input.dueDate !== null && !validDay(input.dueDate)) return "موعد معتبر را انتخاب کنید.";
  return null;
}
