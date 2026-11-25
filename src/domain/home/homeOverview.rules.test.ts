import { describe, expect, it } from "vitest";
import { isoToJalali } from "@/shared/lib/jalali";
import type { Task } from "@/domain/task/task.types";
import type { Bill } from "@/domain/bill/bill.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import type { Equipment } from "@/domain/equipment/equipment.types";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import type { Goal } from "@/domain/goal/goal.types";
import type { Activity } from "@/domain/activity/activity.types";
import { deriveNotifications } from "@/domain/notification/notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "@/domain/notification/notification.types";
import { deriveHomeOverview, type HomeOverviewInput } from "./homeOverview.rules";

const stamp = "2026-11-15T00:00:00Z";
const task = (patch: Partial<Task> = {}): Task => ({
  id: "task-1", title: "کار خانه", description: null, assigneeId: "member-1",
  dueDate: "2026-11-15", completed: false, completedAt: null, completedBy: null,
  createdBy: "member-1", revision: 1, createdAt: stamp, updatedAt: stamp, ...patch,
});
const bill = (patch: Partial<Bill> = {}): Bill => ({
  id: "bill-1", kind: "electricity", title: "قبض برق", amount: "1000", dueDate: "2026-11-15",
  billNo: null, paymentNo: null, state: "unpaid", paidAt: null, paidByMemberId: null,
  transactionId: null, note: null, createdBy: "member-1", createdAt: stamp, ...patch,
});
const event = (patch: Partial<FamilyEvent> = {}): FamilyEvent => ({
  id: "event-1", familyId: "family-1", memberId: "member-1", forMemberId: null,
  title: "تولد", date: "2026-11-15", note: null, createdAt: stamp, ...patch,
});
const equipment = (patch: Partial<Equipment> = {}): Equipment => ({
  id: "equipment-1", title: "فیلتر آب", brand: null, model: null, purchaseDate: null,
  warrantyUntil: null, warrantyDocumentId: null, serviceTaskId: null,
  serviceDueDate: "2026-11-15", serviceReminderEnabled: false, createdBy: "member-1",
  revision: 1, createdAt: stamp, updatedAt: stamp, canEdit: true, canDelete: true, ...patch,
});
const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({
  id: "vehicle-1", title: "خودرو", brand: null, model: null, plate: null,
  purchaseDate: null, odometer: 10_000, insuranceUntil: null, inspectionUntil: null,
  documentId: null, serviceTaskId: null, serviceDueDate: "2026-11-15", serviceDueOdometer: null,
  serviceReminderEnabled: false, createdBy: "member-1", revision: 1,
  createdAt: stamp, updatedAt: stamp, canEdit: true, canDelete: true, canViewHistory: true, ...patch,
});
const goal = (patch: Partial<Goal> = {}): Goal => ({
  id: "goal-1", ownerId: "member-1", kind: "goal", title: "هدف من", note: null,
  targetDate: "2026-11-15", status: "active", reminderEnabled: false,
  revision: 1, createdAt: stamp, updatedAt: stamp, ...patch,
});
const activity = (patch: Partial<Activity> = {}): Activity => ({
  id: "activity-1", title: "تفریح خانواده", note: null, date: "2026-11-15", location: null,
  status: "planned", participantIds: [], reminderEnabled: false, createdBy: "member-1",
  revision: 1, createdAt: stamp, updatedAt: stamp, canEdit: true, canDelete: true, ...patch,
});
const input = (patch: Partial<HomeOverviewInput> = {}): HomeOverviewInput => ({
  bills: [], events: [], memberId: "member-1", role: "member",
  todayJ: isoToJalali("2026-11-15"), ...patch,
});
const reminders = (data: HomeOverviewInput) => deriveNotifications({
  ...data, txs: [], joinRequests: [], inventory: [], shoppingLists: [],
  prefs: DEFAULT_NOTIFICATION_PREFS, dismissed: new Set(),
});

describe("home work overview", () => {
  it("shows due household work for other assignees and unassigned tasks, preserving reminder scope", () => {
    const data = input({ tasks: [
      task(), task({ id: "other", assigneeId: "member-2" }),
      task({ id: "unassigned", assigneeId: null }), task({ id: "undated", dueDate: null }),
    ] });
    expect(deriveHomeOverview(data).today.map((row) => row.id)).toEqual([
      "tasks:other", "tasks:task-1", "tasks:unassigned",
    ]);
    expect(reminders(data).map((row) => row.id)).toEqual(["tasks:task-1", "tasks:undated"]);
  });

  it("shows today and tomorrow and excludes older or distant task deadlines", () => {
    const overview = deriveHomeOverview(input({ tasks: [
      task({ id: "past", dueDate: "2026-11-14" }), task({ id: "today" }),
      task({ id: "tomorrow", dueDate: "2026-11-16" }),
      task({ id: "boundary", dueDate: "2026-11-22" }),
      task({ id: "beyond", dueDate: "2026-11-23" }),
    ] }));
    expect(overview.overdue).toEqual([]);
    expect(overview.today.map((row) => row.id)).toEqual(["tasks:today"]);
    expect(overview.upcoming.map((row) => row.id)).toEqual(["tasks:tomorrow"]);
  });

  it("uses the same date boundary across a Gregorian year transition", () => {
    const overview = deriveHomeOverview(input({ todayJ: isoToJalali("2026-12-31"), bills: [
      bill({ id: "near", dueDate: "2027-01-01" }), bill({ id: "later", dueDate: "2027-01-02" }),
    ] }));
    expect(overview.upcoming.map((row) => row.id)).toEqual(["bills:near"]);
  });

  it("uses the same date boundary across a Jalali year transition", () => {
    const overview = deriveHomeOverview(input({ todayJ: isoToJalali("2027-03-20"), events: [
      event({ id: "near", date: "2027-03-21" }), event({ id: "later", date: "2027-03-22" }),
    ] }));
    expect(overview.upcoming.map((row) => row.ref)).toEqual([
      { kind: "event", eventId: "near", dateIso: "2027-03-21" },
    ]);
  });

  it("shows muted service and personal deadlines while leaving optional reminders muted", () => {
    const data = input({ equipment: [equipment()], vehicles: [vehicle()],
      goals: [goal()], activities: [activity()] });
    expect(deriveHomeOverview(data).today.map((row) => row.domain).sort()).toEqual([
      "activities", "equipment", "goals", "vehicles",
    ]);
    expect(reminders(data)).toEqual([]);
  });

  it("does not use global/domain reminder preferences or event dismissal to hide scheduled work", () => {
    const data = { ...input({ events: [event()], bills: [bill()] }),
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false,
        domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, event: false, bills: false } },
      dismissed: new Set(["event:event-1:2026-11-15"]),
    };
    expect(deriveHomeOverview(data).today.map((row) => row.domain).sort()).toEqual(["bills", "event"]);
  });

  it("excludes private goals belonging to another member even for a family administrator", () => {
    for (const role of ["member", "admin", "owner"] as const) {
      const overview = deriveHomeOverview(input({ role, goals: [goal(), goal({ id: "foreign", ownerId: "member-2" })] }));
      expect(overview.today.map((row) => row.id)).toEqual(["goals:goal-1:2026-11-15"]);
    }
  });

  it("requires an account context before returning any deadline", () => {
    expect(deriveHomeOverview(input({ memberId: undefined, tasks: [task()], bills: [bill()],
      events: [event()], goals: [goal()] }))).toEqual({ overdue: [], today: [], upcoming: [] });
  });

  it("keeps canonical family activities once when they also appear in calendar events", () => {
    const data = input({ events: [event({ id: "activity-1", kind: "activity", activityStatus: "planned" })],
      activities: [activity()] });
    expect(deriveHomeOverview(data).today).toHaveLength(1);
    expect(deriveHomeOverview(data).today[0].ref).toEqual({ kind: "activities", activityId: "activity-1" });
  });

  it("removes completed tasks and goals, paid/cancelled bills, and finished/cancelled activities", () => {
    const overview = deriveHomeOverview(input({
      tasks: [task({ completed: true })], goals: [goal({ status: "done" })],
      bills: [bill({ state: "paid" }), bill({ id: "cancelled", state: "cancelled" })],
      activities: [activity({ status: "done" }), activity({ id: "cancelled", status: "cancelled" })],
    }));
    expect(overview).toEqual({ overdue: [], today: [], upcoming: [] });
  });

  it("treats an odometer-only service reached exactly as due now and a passed target as overdue", () => {
    const data = input({ vehicles: [
      vehicle({ id: "below", serviceDueDate: null, serviceDueOdometer: 10_001 }),
      vehicle({ id: "reached", serviceDueDate: null, serviceDueOdometer: 10_000 }),
      vehicle({ id: "passed", serviceDueDate: null, serviceDueOdometer: 9_999 }),
    ] });
    const overview = deriveHomeOverview(data);
    expect(overview.today.map((row) => row.ref)).toEqual([{ kind: "vehicles", vehicleId: "reached", reason: "service" }]);
    expect(overview.overdue.map((row) => row.ref)).toEqual([{ kind: "vehicles", vehicleId: "passed", reason: "service" }]);
    expect(overview.upcoming).toEqual([]);
  });

  it("keeps service due by mileage actionable even if its date is beyond tomorrow", () => {
    const overview = deriveHomeOverview(input({ vehicles: [vehicle({
      serviceDueDate: "2027-01-15", serviceDueOdometer: 10_000,
    })] }));
    expect(overview.today).toHaveLength(1);
    expect(overview.today[0].ref).toEqual({ kind: "vehicles", vehicleId: "vehicle-1", reason: "service" });
    expect(overview.upcoming).toEqual([]);
  });

  it("emits one service entry when both date and odometer conditions are reached", () => {
    const overview = deriveHomeOverview(input({ vehicles: [vehicle({ serviceDueOdometer: 10_000 })] }));
    expect(overview.today).toHaveLength(1);
  });

  it("preserves separate warranty, insurance and inspection deadlines and strips no protected fields", () => {
    const overview = deriveHomeOverview(input({
      equipment: [equipment({ serviceDueDate: null, warrantyUntil: "2026-11-16" })],
      vehicles: [vehicle({ serviceDueDate: null, insuranceUntil: "2026-11-15", inspectionUntil: "2026-11-16" })],
    }));
    expect(overview.overdue).toEqual([]);
    expect(overview.today[0].ref).toEqual({ kind: "vehicles", vehicleId: "vehicle-1", reason: "insurance" });
    expect(overview.upcoming.map(item => item.ref)).toEqual([
      { kind: "equipment", equipmentId: "equipment-1", reason: "warranty" },
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "inspection" },
    ]);
    expect(JSON.stringify(overview)).not.toContain("amount");
    expect(JSON.stringify(overview)).not.toContain("plate");
  });

  it("returns stable order regardless of source order and leaves the input unchanged", () => {
    const rows = [task({ id: "z" }), task({ id: "a" }), task({ id: "m" })];
    const data = input({ tasks: rows });
    const before = structuredClone(data);
    expect(deriveHomeOverview(data)).toEqual(deriveHomeOverview(input({ tasks: [...rows].reverse() })));
    expect(data).toEqual(before);
    expect(deriveHomeOverview(data).today.map((row) => row.id)).toEqual(["tasks:a", "tasks:m", "tasks:z"]);
  });
});
