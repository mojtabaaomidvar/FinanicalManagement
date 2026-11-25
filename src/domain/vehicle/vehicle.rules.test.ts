import { describe, expect, it } from "vitest";
import { isVehicleDay, odometerValue, serviceCost, vehicleError, vehicleServiceError, vehicleToday } from "./vehicle.rules";
import type { VehicleInput, VehicleServiceInput } from "./vehicle.types";
import { MAX_AMOUNT } from "@/domain/transaction/transaction.rules";
const today = "2026-11-15";
const vehicle: VehicleInput = { title: "خودروی خانواده", odometer: 50000, serviceReminderEnabled: true };
const service: VehicleServiceInput = { performedOn: today, description: "تعویض روغن", performedOdometer: 50000 };

describe("vehicle dates and odometer", () => {
  it("uses Tehran midnight and rejects impossible calendar days", () => {
    expect(vehicleToday(new Date("2026-11-14T20:30:00Z"))).toBe(today);
    expect(isVehicleDay("2026-02-30")).toBe(false);
    expect(isVehicleDay("2024-02-29")).toBe(true);
  });
  it("reads Persian grouped kilometers without converting fractions or negative signs", () => {
    expect(odometerValue("۵۰٬۱۲۳")).toBe(50123);
    expect(odometerValue("50,123")).toBe(50123);
    expect(odometerValue("۵۰٫۵")).toBeNaN();
    expect(odometerValue("-۵۰")).toBeNaN();
    expect(odometerValue("")).toBeNaN();
  });
  it("rejects a decreasing, fractional or out-of-range odometer", () => {
    expect(vehicleError(vehicle, 50001, today)).not.toBe("");
    expect(vehicleError({ ...vehicle, odometer: 50000.5 }, 0, today)).not.toBe("");
    expect(vehicleError({ ...vehicle, odometer: 100000001 }, 0, today)).not.toBe("");
    expect(vehicleError(vehicle, 50000, today)).toBe("");
  });
  it("allows independent document dates but not a future purchase", () => {
    expect(vehicleError({ ...vehicle, purchaseDate: "2026-11-16" }, 0, today)).not.toBe("");
    expect(vehicleError({ ...vehicle, insuranceUntil: "2025-01-01", inspectionUntil: "2027-01-01" }, 0, today)).toBe("");
  });
});

describe("vehicle completion and financial input", () => {
  it("accepts a service today without another deadline or cost", () => {
    expect(vehicleServiceError(service, 50000, today)).toBe("");
    expect(serviceCost("", "ریال")).toBeNull();
  });
  it("requires performed and next kilometers to preserve forward mileage", () => {
    expect(vehicleServiceError({ ...service, performedOdometer: 49999 }, 50000, today)).not.toBe("");
    expect(vehicleServiceError({ ...service, nextDueOdometer: 50000 }, 50000, today)).not.toBe("");
    expect(vehicleServiceError({ ...service, nextDueOdometer: 55000 }, 50000, today)).toBe("");
  });
  it("requires future next date and rejects unperformed future services", () => {
    expect(vehicleServiceError({ ...service, performedOn: "2026-11-16" }, 50000, today)).not.toBe("");
    expect(vehicleServiceError({ ...service, nextDueDate: today }, 50000, today)).not.toBe("");
  });
  it("reuses toman storage and personal rial display conversion", () => {
    expect(serviceCost("۱,۵۰۰,۰۰۰", "تومان")).toBe(1500000);
    expect(serviceCost("۱,۵۰۰,۰۰۰", "ریال")).toBe(150000);
    expect(() => serviceCost("۰", "تومان")).toThrow();
    expect(() => serviceCost("۴", "ریال")).toThrow();
    expect(() => serviceCost("-۱۲", "تومان")).toThrow();
  });
  it("rejects an account without cost and permits an unspecified account for a cost", () => {
    expect(vehicleServiceError({ ...service, accountId: "account" }, 50000, today)).not.toBe("");
    expect(vehicleServiceError({ ...service, costAmount: 100000, accountId: null }, 50000, today)).toBe("");
  });
  it("uses Finance's amount ceiling for both currency conversion and service validation", () => {
    const legacyCeiling = Number(MAX_AMOUNT);
    expect(serviceCost(MAX_AMOUNT, "تومان")).toBe(legacyCeiling);
    expect(serviceCost(String(legacyCeiling * 10), "ریال")).toBe(legacyCeiling);
    expect(() => serviceCost(String(legacyCeiling + 1), "تومان")).toThrow();
    expect(vehicleServiceError({ ...service, costAmount: legacyCeiling + 1 }, 50000, today)).not.toBe("");
  });
});
