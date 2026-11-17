import { describe, expect, it } from "vitest";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import { filterVehicles, kmDue, vehicleServiceLabel } from "./vehiclePresentation";
const today = "2026-11-15";
const vehicle = (change: Partial<Vehicle>): Vehicle => ({
  id: "vehicle", title: "خودروی خانواده", brand: "نمونه", model: "A", plate: null, purchaseDate: null,
  odometer: 50000, insuranceUntil: null, inspectionUntil: null, documentId: null, serviceTaskId: null,
  serviceDueDate: null, serviceDueOdometer: null, serviceReminderEnabled: true,
  createdBy: "member", revision: 1, createdAt: "", updatedAt: "", canEdit: true, canDelete: true, canViewHistory: true, ...change,
});
describe("vehicle due state and permitted list search", () => {
  it("treats exact mileage as due without predicting near-mileage dates", () => {
    const due = vehicle({ serviceDueOdometer: 50000 });
    expect(kmDue(due)).toBe(true);
    expect(vehicleServiceLabel(due, today)).toBe("موعد کیلومتری سرویس رسیده");
    expect(filterVehicles([vehicle({ serviceDueOdometer: 50001 })], "service", "", today)).toEqual([]);
    expect(filterVehicles([due], "service", "", today)).toHaveLength(1);
  });
  it("distinguishes passed mileage/date from a deadline today", () => {
    expect(filterVehicles([vehicle({ serviceDueOdometer: 49999 })], "overdue", "", today)).toHaveLength(1);
    expect(filterVehicles([vehicle({ serviceDueDate: today })], "overdue", "", today)).toEqual([]);
    expect(filterVehicles([vehicle({ serviceDueDate: "2026-11-14" })], "overdue", "", today)).toHaveLength(1);
  });
  it("handles insurance/inspection independently and no fields for restricted rows", () => {
    const permitted = vehicle({ insuranceUntil: "2026-11-20", inspectionUntil: "2027-01-01", plate: "نمونه ۱۲" });
    expect(filterVehicles([permitted], "insurance", "۱۲", today)).toHaveLength(1);
    expect(filterVehicles([permitted], "inspection", "", today)).toEqual([]);
    expect(filterVehicles([vehicle({ canViewHistory: false })], "insurance", "", today)).toEqual([]);
  });
});
