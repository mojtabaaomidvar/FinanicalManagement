import { describe, expect, it } from "vitest";
import type { Equipment } from "@/domain/equipment/equipment.types";
import { daysUntil, filterEquipment, serviceLabel, warrantyLabel } from "./equipmentPresentation";

const item = (change: Partial<Equipment>): Equipment => ({
  id: "one", title: "یخچال", brand: "نمونه", model: "A", purchaseDate: null,
  warrantyUntil: null, warrantyDocumentId: null, serviceTaskId: null,
  serviceDueDate: null, serviceReminderEnabled: true, createdBy: "member", revision: 1,
  createdAt: "", updatedAt: "", canEdit: true, canDelete: true, ...change,
});
const today = "2026-11-15";

describe("equipment list status", () => {
  it("keeps undated items out of due-date filters", () => {
    expect(daysUntil(null, today)).toBeNull();
    expect(filterEquipment([item({})], "service", "", today)).toEqual([]);
    expect(serviceLabel(item({}), today)).toBe("بدون موعد سرویس");
  });
  it("distinguishes overdue, today and seven-day horizon", () => {
    const rows = [item({ id: "past", serviceDueDate: "2026-11-14" }), item({ id: "today", serviceDueDate: today }),
      item({ id: "week", serviceDueDate: "2026-11-22" }), item({ id: "later", serviceDueDate: "2026-11-23" })];
    expect(filterEquipment(rows, "overdue", "", today).map((row) => row.id)).toEqual(["past"]);
    expect(filterEquipment(rows, "service", "", today).map((row) => row.id)).toEqual(["today", "week"]);
    expect(serviceLabel(rows[1], today)).toBe("موعد سرویس امروز");
  });
  it("combines model search with warranty state", () => {
    const rows = [item({ id: "old", warrantyUntil: "2026-11-14" }), item({ id: "future", model: "B", warrantyUntil: "2027-11-15" })];
    expect(filterEquipment(rows, "warranty", " A ", today).map((row) => row.id)).toEqual(["old"]);
    expect(warrantyLabel(rows[0], today)).toBe("گارانتی تمام شده");
  });
});
