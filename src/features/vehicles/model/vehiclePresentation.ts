import type { Vehicle } from "@/domain/vehicle/vehicle.types";
export type VehicleFilter = "all" | "service" | "overdue" | "insurance" | "inspection";
export function vehicleDaysUntil(date: string | null, today: string): number | null {
  return date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) : null;
}
export function kmDue(vehicle: Vehicle): boolean {
  return vehicle.serviceDueOdometer !== null && vehicle.odometer >= vehicle.serviceDueOdometer;
}
export function filterVehicles(rows: Vehicle[], filter: VehicleFilter, query: string, today: string): Vehicle[] {
  const term = query.trim().toLocaleLowerCase("fa");
  return rows.filter((vehicle) => {
    if (term && ![vehicle.title, vehicle.brand ?? "", vehicle.model ?? "", vehicle.plate ?? ""].some((value) => value.toLocaleLowerCase("fa").includes(term))) return false;
    const service = vehicleDaysUntil(vehicle.serviceDueDate, today);
    if (filter === "service") return kmDue(vehicle) || service !== null && service >= 0 && service <= 7;
    if (filter === "overdue") return service !== null && service < 0 || vehicle.serviceDueOdometer !== null && vehicle.odometer > vehicle.serviceDueOdometer;
    if (filter === "insurance" || filter === "inspection") {
      const days = vehicleDaysUntil(filter === "insurance" ? vehicle.insuranceUntil : vehicle.inspectionUntil, today);
      return days !== null && days <= 7;
    }
    return true;
  });
}
export function vehicleServiceLabel(vehicle: Vehicle, today: string): string {
  if (kmDue(vehicle)) return "موعد کیلومتری سرویس رسیده";
  const days = vehicleDaysUntil(vehicle.serviceDueDate, today);
  if (days === null) return vehicle.serviceDueOdometer !== null ? "سرویس برحسب کیلومتر" : "بدون موعد سرویس";
  if (days < 0) return "موعد سرویس گذشته";
  if (days === 0) return "موعد سرویس امروز";
  return days <= 7 ? "سرویس در هفت روز آینده" : "سرویس برنامه‌ریزی‌شده";
}
