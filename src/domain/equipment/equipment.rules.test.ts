import { describe, expect, it } from "vitest";
import { equipmentError, isCalendarDay, maintenanceError, tehranToday } from "./equipment.rules";

describe("equipment calendar days", () => {
  it("rejects normalized impossible dates and non-canonical dates", () => {
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2026-2-03")).toBe(false);
    expect(isCalendarDay("2024-02-29")).toBe(true);
  });
  it("uses the Tehran day at the UTC midnight boundary", () => {
    expect(tehranToday(new Date("2026-11-14T20:29:59Z"))).toBe("2026-11-14");
    expect(tehranToday(new Date("2026-11-14T20:30:00Z"))).toBe("2026-11-15");
  });
  it("allows optional dates but rejects a warranty ending before purchase", () => {
    expect(equipmentError({ title: "کولر", serviceReminderEnabled: true })).toBe("");
    expect(equipmentError({ title: "کولر", purchaseDate: "2026-11-15", warrantyUntil: "2026-11-14", serviceReminderEnabled: true })).not.toBe("");
  });
});

describe("maintenance completion", () => {
  const record = { performedOn: "2026-11-15", description: "تعویض فیلتر" };
  it("accepts a completed service today without another scheduled date", () => {
    expect(maintenanceError(record, "2026-11-15")).toBe("");
  });
  it("rejects claiming completion tomorrow", () => {
    expect(maintenanceError({ ...record, performedOn: "2026-11-16" }, "2026-11-15")).not.toBe("");
  });
  it("requires the next due date to follow completion", () => {
    expect(maintenanceError({ ...record, nextDueDate: "2026-11-15" }, "2026-11-15")).not.toBe("");
    expect(maintenanceError({ ...record, nextDueDate: "2026-11-16" }, "2026-11-15")).toBe("");
  });
  it("rejects a blank description or invalid next date", () => {
    expect(maintenanceError({ ...record, description: "  " }, "2026-11-15")).not.toBe("");
    expect(maintenanceError({ ...record, nextDueDate: "2027-02-29" }, "2026-11-15")).not.toBe("");
  });
});
