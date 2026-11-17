import type { EquipmentInput, MaintenanceInput } from "./equipment.types";

export function isCalendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Use the household's Tehran day even if the device timezone differs. */
export function tehranToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function equipmentError(input: EquipmentInput): string {
  if (!input.title.trim()) return "نام وسیله را بنویسید.";
  if (input.title.trim().length > 120) return "نام وسیله باید حداکثر ۱۲۰ نویسه باشد.";
  if ((input.brand?.trim().length ?? 0) > 80 || (input.model?.trim().length ?? 0) > 80) {
    return "برند و مدل باید حداکثر ۸۰ نویسه باشند.";
  }
  for (const date of [input.purchaseDate, input.warrantyUntil, input.serviceDueDate]) {
    if (date && !isCalendarDay(date)) return "تاریخ را دوباره انتخاب کنید.";
  }
  if (input.purchaseDate && input.warrantyUntil && input.warrantyUntil < input.purchaseDate) {
    return "پایان گارانتی نباید قبل از تاریخ خرید باشد.";
  }
  return "";
}

export function maintenanceError(input: MaintenanceInput, todayIso = tehranToday()): string {
  if (!isCalendarDay(input.performedOn)) return "تاریخ انجام سرویس را انتخاب کنید.";
  if (input.performedOn > todayIso) return "تاریخ انجام سرویس نمی‌تواند بعد از امروز باشد.";
  if (!input.description.trim()) return "شرح سرویس را بنویسید.";
  if (input.description.trim().length > 1000) return "شرح سرویس باید حداکثر ۱۰۰۰ نویسه باشد.";
  if (input.nextDueDate && (!isCalendarDay(input.nextDueDate) || input.nextDueDate <= input.performedOn)) {
    return "موعد سرویس بعدی باید بعد از تاریخ انجام باشد.";
  }
  return "";
}
