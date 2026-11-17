import { describe, expect, it } from "vitest";
import type { Bill } from "@/domain/bill/bill.types";
import type { Equipment } from "@/domain/equipment/equipment.types";
import type { Task } from "@/domain/task/task.types";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import { isoToJalali, jalaliToIso } from "@/shared/lib/jalali";
import { eventCountByDay, eventsOnDay, upcomingEvents } from "./calendar.rules";
import type { FamilyEvent } from "./event.types";
import { deriveCalendarEntries } from "./householdCalendar.rules";
import type { HouseholdCalendarInput } from "./householdCalendar.rules";

const stamp = "2026-11-15T00:00:00Z";
const event = (patch: Partial<FamilyEvent> = {}): FamilyEvent => ({
  id: "event-1", familyId: "family-1", memberId: "member-1", forMemberId: null,
  title: "تولد", date: "2026-11-15", note: "private note", createdAt: stamp, ...patch,
});
type BirthdayMember = NonNullable<HouseholdCalendarInput["members"]>[number];
const birthdayMember = (patch: Partial<BirthdayMember> = {}): BirthdayMember => ({
  id: "member-1", familyId: "family-1", name: "مدیر آزمایشی", birthDate: "1961-11-06",
  status: "active", membershipState: "active", relation: "خودم", ...patch,
});
const birthday = (patch: Partial<FamilyEvent> = {}): FamilyEvent => event({
  forMemberId: "member-1", title: "تولد مدیر آزمایشی", date: "2027-11-06", ...patch,
});
const task = (patch: Partial<Task> = {}): Task => ({
  id: "task-1", title: "کار خانه", description: "private description", assigneeId: "member-1",
  dueDate: "2026-11-15", completed: false, completedAt: null, completedBy: null,
  completionPhotoUrl: "private-file", createdBy: "member-1", revision: 1,
  createdAt: stamp, updatedAt: stamp, ...patch,
});
const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "bill-1", kind: "electricity", title: "قبض برق", amount: 1000, dueDate: "2026-11-15",
  billNo: "private-bill-number", paymentNo: "private-payment-number", state: "unpaid",
  paidAt: null, paidByMemberId: null, transactionId: null, note: "private note",
  createdBy: "member-1", createdAt: stamp, ...patch,
});
const equipment = (patch: Partial<Equipment> = {}): Equipment => ({
  id: "equipment-1", title: "فیلتر آب", brand: null, model: null, purchaseDate: null,
  warrantyUntil: "2026-11-16", warrantyDocumentId: "private-document", serviceTaskId: null,
  serviceDueDate: "2026-11-15", serviceReminderEnabled: false, createdBy: "member-1",
  revision: 1, createdAt: stamp, updatedAt: stamp, canEdit: true, canDelete: true, ...patch,
});
const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({
  id: "vehicle-1", title: "خودرو", brand: null, model: null, plate: "private-plate",
  purchaseDate: null, odometer: 10_000, insuranceUntil: "2026-11-17", inspectionUntil: "2026-11-18",
  documentId: "private-document", serviceTaskId: null, serviceDueDate: "2026-11-16",
  serviceDueOdometer: 9_999, serviceReminderEnabled: false, createdBy: "member-1", revision: 1,
  createdAt: stamp, updatedAt: stamp, canEdit: true, canDelete: true, canViewHistory: true, ...patch,
});

describe("unified household calendar", () => {
  it("shows 15 Aban 1340 in past and future Jalali years even when the canonical date is next year", () => {
    const entries = deriveCalendarEntries({ events: [birthday()], members: [birthdayMember()], birthdayYears: [1405, 1406] });
    expect(entries.map((entry) => entry.date)).toEqual(["2026-11-06", "2027-11-06"]);
    expect(entries.map((entry) => entry.ref)).toEqual([
      { kind: "event", eventId: "event-1", dateIso: "2026-11-06" },
      { kind: "event", eventId: "event-1", dateIso: "2027-11-06" },
    ]);
    expect(eventCountByDay(entries, 1405, 8).get(15)).toBe(1);
    expect(eventsOnDay(entries, [1405, 8, 15])[0]?.id).toBe("event:event-1:birthday:1405");
    expect(entries[0]).not.toHaveProperty("birthDate");
  });

  it("starts birthdays after the birth year and deduplicates requested years and source rows", () => {
    const entries = deriveCalendarEntries({ events: [birthday(), birthday()], members: [birthdayMember()],
      birthdayYears: [1339, 1340, 1341, 1405, 1405, NaN, Infinity, 1405.5, 0, 9378] });
    expect(entries.map((entry) => isoToJalali(entry.date))).toEqual([[1341, 8, 15], [1405, 8, 15]]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
    expect(deriveCalendarEntries({ events: [birthday()], members: [birthdayMember()], birthdayYears: [] })).toEqual([]);
  });

  it("uses the profile's original Esfand 30 even when the next stored birthday was clamped to 29", () => {
    const entries = deriveCalendarEntries({
      events: [birthday({ date: "2022-03-20" })], members: [birthdayMember({ birthDate: "2021-03-20" })],
      birthdayYears: [1400, 1403],
    });
    expect(entries.map((entry) => entry.date)).toEqual(["2022-03-20", "2025-03-20"]);
    expect(entries.map((entry) => isoToJalali(entry.date))).toEqual([[1400, 12, 29], [1403, 12, 30]]);
  });

  it("keeps activities, ordinary occasions and unlinked birthday titles as single dated records", () => {
    const originalEvents = [
      birthday({ id: "activity", kind: "activity", activityStatus: "planned" }),
      birthday({ id: "unlinked", forMemberId: null }),
      birthday({ id: "manual", title: "تولد دوستان" }),
      birthday({ id: "other-family", familyId: "family-2" }),
    ];
    const entries = deriveCalendarEntries({ events: originalEvents, members: [birthdayMember()], birthdayYears: [1405, 1406] });
    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.date === "2027-11-06")).toBe(true);
    expect(entries.find((entry) => entry.id === "event:activity")?.source).toBe("activity");
    expect(entries.every((entry) => !entry.id.includes(":birthday:"))).toBe(true);
  });

  it("does not project stale profile birthdays after DOB removal, invalid dates or ineligible membership", () => {
    for (const member of [
      birthdayMember({ birthDate: null }), birthdayMember({ birthDate: "2026-02-30" }),
      birthdayMember({ birthDate: "0001-01-01" }), birthdayMember({ birthDate: "9999-12-31" }),
      birthdayMember({ membershipState: "suspended" }), birthdayMember({ membershipState: null }),
      birthdayMember({ status: "pending", relation: "سایر" }),
    ]) {
      expect(deriveCalendarEntries({ events: [birthday()], members: [member], birthdayYears: [1405] })).toEqual([]);
    }
    expect(deriveCalendarEntries({ events: [birthday()], members: [birthdayMember({ status: "pending", relation: "فرزند" })],
      birthdayYears: [1405] })).toHaveLength(1);
  });

  it("preserves next-occurrence events when annual projection is not requested", () => {
    const entries = deriveCalendarEntries({ events: [birthday()], members: [birthdayMember()] });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe("event:event-1");
    expect(entries[0]?.date).toBe("2027-11-06");
  });

  it("keeps upcoming profile birthdays across Jalali New Year independent of the displayed past year", () => {
    const entries = deriveCalendarEntries({ events: [birthday({ date: "2027-03-31" })],
      members: [birthdayMember({ birthDate: jalaliToIso([1380, 1, 11]) })], birthdayYears: [1404, 1405, 1406] });
    expect(upcomingEvents(entries, [1405, 12, 20], 30).map((entry) => isoToJalali(entry.date)))
      .toEqual([[1406, 1, 11]]);
  });

  it("shows the canonical source destinations with muted item reminders", () => {
    const entries = deriveCalendarEntries({ events: [event()], tasks: [task()], bills: [bill()],
      equipment: [equipment()], vehicles: [vehicle()] });
    expect(entries).toHaveLength(8);
    expect(entries.map((entry) => entry.ref)).toContainEqual({ kind: "tasks", taskId: "task-1" });
    expect(entries.map((entry) => entry.ref)).toContainEqual({ kind: "bills", billId: "bill-1", dueIso: "2026-11-15" });
    expect(entries.map((entry) => entry.ref)).toContainEqual({ kind: "event", eventId: "event-1", dateIso: "2026-11-15" });
    expect(entries.map((entry) => entry.ref)).toContainEqual({ kind: "equipment", equipmentId: "equipment-1", reason: "service" });
    expect(entries.map((entry) => entry.ref)).toContainEqual({ kind: "vehicles", vehicleId: "vehicle-1", reason: "inspection" });
  });

  it("removes completed, paid and cancelled records without retaining old calendar copies", () => {
    const liveTask = task();
    const liveBill = bill();
    expect(deriveCalendarEntries({ events: [], tasks: [liveTask], bills: [liveBill] })).toHaveLength(2);
    expect(deriveCalendarEntries({ events: [], tasks: [{ ...liveTask, completed: true }],
      bills: [{ ...liveBill, state: "paid" }, bill({ id: "cancelled", state: "cancelled" })] })).toEqual([]);
    expect(deriveCalendarEntries({ events: [] })).toEqual([]);
  });

  it("preserves legacy events and produces one activity target for the same calendar record", () => {
    const activity = event({ id: "activity-1", kind: "activity", activityStatus: "planned", reminderEnabled: false });
    const entries = deriveCalendarEntries({ events: [event(), activity, activity] });
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.source === "activity")?.ref).toEqual({ kind: "activities", activityId: "activity-1" });
  });

  it("preserves completed, cancelled and older activity records in calendar history", () => {
    const entries = deriveCalendarEntries({ events: [
      event({ id: "done", kind: "activity", activityStatus: "done" }),
      event({ id: "cancelled", kind: "activity", activityStatus: "cancelled" }),
      event({ id: "unknown", kind: "activity", activityStatus: null }),
      event({ id: "legacy", kind: "activity", activityStatus: undefined }),
    ] });
    expect(entries.map((entry) => entry.id)).toEqual([
      "event:cancelled", "event:done", "event:legacy", "event:unknown",
    ]);
    expect(entries.every((entry) => entry.source === "activity")).toBe(true);
    const planned = event({ kind: "activity", activityStatus: "planned" });
    expect(deriveCalendarEntries({ events: [{ ...planned, activityStatus: "done" }] }))
      .toEqual(deriveCalendarEntries({ events: [planned] }));
  });

  it("keeps same-day service and warranty or insurance and inspection distinct", () => {
    const date = "2026-11-15";
    const entries = deriveCalendarEntries({ events: [],
      equipment: [equipment({ warrantyUntil: date })],
      vehicles: [vehicle({ serviceDueDate: date, insuranceUntil: date, inspectionUntil: date })],
    });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(5);
    expect(eventCountByDay(entries, ...isoToJalali(date).slice(0, 2) as [number, number])
      .get(isoToJalali(date)[2])).toBe(5);
  });

  it("keeps different domain records distinct when their source IDs happen to match", () => {
    const entries = deriveCalendarEntries({ events: [event({ id: "same" })],
      tasks: [task({ id: "same" })], bills: [bill({ id: "same" })] });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
  });

  it("ignores absent deadlines and does not turn mileage-only service into today's date", () => {
    expect(deriveCalendarEntries({ events: [], tasks: [task({ dueDate: null })],
      equipment: [equipment({ serviceDueDate: null, warrantyUntil: null })],
      vehicles: [vehicle({ serviceDueDate: null, insuranceUntil: null, inspectionUntil: null })],
    })).toEqual([]);
  });

  it("retains an actual future service date even if mileage has already passed", () => {
    const entries = deriveCalendarEntries({ events: [], vehicles: [vehicle({
      serviceDueDate: "2026-12-15", insuranceUntil: null, inspectionUntil: null,
    })] });
    expect(entries[0]?.date).toBe("2026-12-15");
  });

  it("ignores malformed, timestamp and impossible Gregorian days", () => {
    const dates = ["2026-02-29", "2026-02-30", "2026-13-01", "2026-11-31", "2026-11-15T00:00:00Z", "2026-1-1", "bad"];
    expect(deriveCalendarEntries({ events: dates.map((date, index) => event({ id: String(index), date })) })).toEqual([]);
    expect(deriveCalendarEntries({ events: [event({ date: "2028-02-29" })] })[0]?.date).toBe("2028-02-29");
  });

  it("uses Jalali month/day helpers across Gregorian month boundaries", () => {
    const first = jalaliToIso([1405, 8, 1]);
    const last = jalaliToIso([1405, 8, 30]);
    const next = jalaliToIso([1405, 9, 1]);
    const entries = deriveCalendarEntries({ events: [event({ id: "next", date: next })],
      tasks: [task({ dueDate: last })], bills: [bill({ dueDate: first })] });
    const counts = eventCountByDay(entries, 1405, 8);
    expect([...counts.entries()]).toEqual([[1, 1], [30, 1]]);
    expect(eventsOnDay(entries, [1405, 9, 1]).map((entry) => entry.id)).toEqual(["event:next"]);
  });

  it("keeps the 30-day upcoming boundary inclusive across Jalali New Year", () => {
    const entries = deriveCalendarEntries({ events: [
      event({ id: "past", date: jalaliToIso([1405, 12, 19]) }),
      event({ id: "today", date: jalaliToIso([1405, 12, 20]) }),
      event({ id: "boundary", date: jalaliToIso([1406, 1, 21]) }),
      event({ id: "outside", date: jalaliToIso([1406, 1, 22]) }),
    ] });
    expect(upcomingEvents(entries, [1405, 12, 20], 30).map((entry) => entry.id))
      .toEqual(["event:today", "event:boundary"]);
  });

  it("does not copy notes, bills, account or document metadata into calendar entries", () => {
    const entries = deriveCalendarEntries({ events: [event()], tasks: [task()], bills: [bill()],
      equipment: [equipment()], vehicles: [vehicle()] });
    expect(JSON.stringify(entries)).not.toContain("private");
    for (const entry of entries) expect(Object.keys(entry).sort()).toEqual(["date", "id", "ref", "source", "title"]);
  });

  it("sorts across sources without mutating their snapshots", () => {
    const events = Object.freeze([event({ id: "late", date: "2026-12-01" }), event({ id: "early", date: "2026-11-01" })]);
    const tasks = Object.freeze([task({ dueDate: "2026-11-15" })]);
    const entries = deriveCalendarEntries({ events, tasks });
    expect(entries.map((entry) => entry.date)).toEqual(["2026-11-01", "2026-11-15", "2026-12-01"]);
    expect(events.map((entry) => entry.id)).toEqual(["late", "early"]);
    expect(deriveCalendarEntries({ events: [...events].reverse(), tasks })).toEqual(entries);
  });
});
