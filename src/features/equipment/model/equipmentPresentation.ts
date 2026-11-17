import type { Equipment } from "@/domain/equipment/equipment.types";

export type EquipmentFilter = "all" | "service" | "overdue" | "warranty";

export function daysUntil(dateIso: string | null, todayIso: string): number | null {
  if (!dateIso) return null;
  return Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
}

export function filterEquipment(items: Equipment[], filter: EquipmentFilter, query: string, todayIso: string): Equipment[] {
  const term = query.trim().toLocaleLowerCase("fa");
  return items.filter((item) => {
    if (term && ![item.title, item.brand ?? "", item.model ?? ""].some((value) => value.toLocaleLowerCase("fa").includes(term))) return false;
    const service = daysUntil(item.serviceDueDate, todayIso);
    const warranty = daysUntil(item.warrantyUntil, todayIso);
    if (filter === "service") return service !== null && service >= 0 && service <= 7;
    if (filter === "overdue") return service !== null && service < 0;
    if (filter === "warranty") return warranty !== null && warranty <= 7;
    return true;
  });
}

export function serviceLabel(item: Equipment, todayIso: string): string {
  const days = daysUntil(item.serviceDueDate, todayIso);
  if (days === null) return "بدون موعد سرویس";
  if (days < 0) return "موعد سرویس گذشته";
  if (days === 0) return "موعد سرویس امروز";
  if (days <= 7) return "سرویس در هفت روز آینده";
  return "سرویس برنامه‌ریزی‌شده";
}

export function warrantyLabel(item: Equipment, todayIso: string): string {
  const days = daysUntil(item.warrantyUntil, todayIso);
  if (days === null) return "بدون تاریخ گارانتی";
  if (days < 0) return "گارانتی تمام شده";
  if (days === 0) return "گارانتی تا امروز";
  if (days <= 7) return "گارانتی رو به پایان";
  return "گارانتی معتبر";
}
