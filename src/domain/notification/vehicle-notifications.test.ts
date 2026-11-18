import { describe, expect, it } from "vitest";
import type { Vehicle } from "@/domain/vehicle/vehicle.types";
import { isoToJalali } from "@/shared/lib/jalali";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";

const vehicle = (patch: Partial<Vehicle> = {}): Vehicle => ({
  id: "vehicle-1", title: "خودروی خانواده", brand: null, model: null, plate: null,
  purchaseDate: null, odometer: 10_000, insuranceUntil: null, inspectionUntil: null,
  documentId: null, serviceTaskId: null, serviceDueDate: "2026-11-16",
  serviceDueOdometer: null, serviceReminderEnabled: true, createdBy: "member-1",
  revision: 1, createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z",
  canEdit: true, canDelete: true, canViewHistory: true, ...patch,
});

const input = (rows: Vehicle[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  vehicles: rows, memberId: "member-1", role: "member", prefs: DEFAULT_NOTIFICATION_PREFS,
  dismissed: new Set(), todayJ: isoToJalali("2026-11-15"), ...patch,
});

describe("vehicle service, insurance and inspection reminders", () => {
  it("shows today and tomorrow and excludes historical or distant service dates", () => {
    const notes = deriveNotifications(input([
      vehicle({ id: "past", serviceDueDate: "2026-11-14" }),
      vehicle({ id: "today", serviceDueDate: "2026-11-15" }),
      vehicle({ id: "boundary", serviceDueDate: "2026-11-16" }),
      vehicle({ id: "beyond", serviceDueDate: "2026-11-17" }),
    ]));
    expect(DEFAULT_NOTIFICATION_PREFS.domains.vehicles).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.leadDays.vehicles).toBe(1);
    expect(notes.map((note) => [note.ref, note.severity])).toEqual([
      [{ kind: "vehicles", vehicleId: "today", reason: "service" }, "pending"],
      [{ kind: "vehicles", vehicleId: "boundary", reason: "service" }, "soon"],
    ]);
  });

  it("starts a mileage-only reminder exactly at the target without an early threshold", () => {
    const target = vehicle({ serviceDueDate: null, serviceDueOdometer: 10_000 });
    expect(deriveNotifications(input([{ ...target, odometer: 9_999 }]))).toEqual([]);
    expect(deriveNotifications(input([target]))).toEqual([{
      id: "vehicles:vehicle-1:service:none:10000", domain: "vehicles", severity: "pending",
      dateIso: null, dismissible: false,
      ref: { kind: "vehicles", vehicleId: "vehicle-1", reason: "service" },
    }]);
    expect(deriveNotifications(input([{ ...target, odometer: 10_001 }]))[0].severity).toBe("overdue");
  });

  it("uses either schedule condition and emits a single service reminder when both apply", () => {
    const both = vehicle({ serviceDueOdometer: 10_000 });
    expect(deriveNotifications(input([both]))).toHaveLength(1);
    expect(deriveNotifications(input([both]))[0].severity).toBe("pending");
    const dateOnly = deriveNotifications(input([{ ...both, odometer: 9_999 }]));
    expect(dateOnly).toHaveLength(1);
    expect(dateOnly[0].severity).toBe("soon");
    const mileageOnly = deriveNotifications(input([{ ...both, serviceDueDate: "2027-01-15" }]));
    expect(mileageOnly).toHaveLength(1);
    expect(mileageOnly[0].severity).toBe("pending");
    expect(deriveNotifications(input([{ ...both, serviceDueDate: "2026-11-14" }]))[0]).toMatchObject({ severity: "pending", dateIso: null });
  });

  it("keeps insurance and inspection separate even when all dates are the same", () => {
    const notes = deriveNotifications(input([vehicle({
      insuranceUntil: "2026-11-16", inspectionUntil: "2026-11-16",
    })]));
    expect(notes.map((note) => note.ref)).toEqual([
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "inspection" },
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "insurance" },
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "service" },
    ]);
    expect(new Set(notes.map((note) => note.id)).size).toBe(3);
  });

  it("applies the same date window and urgency to insurance and inspection", () => {
    const notes = deriveNotifications(input([
      vehicle({ id: "past", serviceDueDate: null, insuranceUntil: "2026-11-14" }),
      vehicle({ id: "today", serviceDueDate: null, inspectionUntil: "2026-11-15" }),
      vehicle({ id: "boundary", serviceDueDate: null, insuranceUntil: "2026-11-16" }),
      vehicle({ id: "beyond", serviceDueDate: null, inspectionUntil: "2026-11-17" }),
    ]));
    expect(notes.map((note) => [note.ref, note.severity])).toEqual([
      [{ kind: "vehicles", vehicleId: "today", reason: "inspection" }, "pending"],
      [{ kind: "vehicles", vehicleId: "boundary", reason: "insurance" }, "soon"],
    ]);
  });

  it("the per-vehicle switch suppresses date and mileage service but preserves other reasons", () => {
    const notes = deriveNotifications(input([vehicle({
      serviceReminderEnabled: false, serviceDueOdometer: 9_000,
      insuranceUntil: "2026-11-15", inspectionUntil: "2026-11-16",
    })]));
    expect(notes.map((note) => note.ref)).toEqual([
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "insurance" },
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "inspection" },
    ]);
    expect(deriveNotifications(input([vehicle({
      serviceDueDate: null, serviceDueOdometer: null,
    })]))).toEqual([]);
  });

  it("respects global and vehicle controls while preserving unrelated domains", () => {
    const rows = [vehicle({ serviceDueOdometer: 9_000, insuranceUntil: "2026-11-16" })];
    const tasks: NonNullable<DeriveInput["tasks"]> = [{
      id: "task-1", title: "کار مشترک", description: null, assigneeId: "member-1", dueDate: null,
      completed: false, completedAt: null, createdAt: "2026-11-15T00:00:00Z",
      completedBy: null, createdBy: "member-1", revision: 1, updatedAt: "2026-11-15T00:00:00Z",
    }];
    const domainOff = { ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, vehicles: false } };
    expect(deriveNotifications(input(rows, { prefs: domainOff, tasks })).map((note) => note.domain)).toEqual(["tasks"]);
    expect(deriveNotifications(input(rows, {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false }, tasks,
    }))).toEqual([]);
  });

  it("ignores legacy date lead days and preserves mileage warnings outside the date window", () => {
    const prefs = (lead: number) => ({ ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, vehicles: lead } });
    for (const lead of [0, -1, NaN, Infinity]) {
      const notes = deriveNotifications(input([
        vehicle({ id: "today", serviceDueDate: "2026-11-15" }),
        vehicle({ id: "tomorrow", serviceDueDate: "2026-11-16" }),
        vehicle({ id: "mileage", serviceDueDate: "2027-01-15", serviceDueOdometer: 10_000 }),
      ], { prefs: prefs(lead) }));
      expect(notes.map((note) => note.ref.kind === "vehicles" ? note.ref.vehicleId : "")).toEqual(["today", "mileage", "tomorrow"]);
    }
    expect(deriveNotifications(input([
      vehicle({ serviceDueDate: "2026-11-16" }),
    ], { prefs: prefs(1.9) }))).toHaveLength(1);
    expect(deriveNotifications(input([
      vehicle({ serviceDueDate: "2026-11-17" }),
    ], { prefs: prefs(1.9) }))).toEqual([]);
    expect(deriveNotifications(input([
      vehicle({ serviceDueDate: "2027-01-15" }),
    ], { prefs: prefs(999) }))).toEqual([]);
  });

  it("keeps an ID as current mileage changes and changes it when the schedule changes", () => {
    const original = vehicle({ serviceDueOdometer: 10_000 });
    const id = deriveNotifications(input([original]))[0].id;
    expect(deriveNotifications(input([{ ...original, odometer: 10_200 }]))[0].id).toBe(id);
    expect(deriveNotifications(input([{ ...original, serviceDueDate: "2026-11-15" }]))[0].id).not.toBe(id);
    expect(deriveNotifications(input([{ ...original, serviceDueOdometer: 10_500 }]))[0].id).not.toBe(id);
    expect(deriveNotifications(input([{ ...original, serviceDueDate: "2027-01-15", serviceDueOdometer: 20_000 }]))).toEqual([]);
  });

  it("requires a current member and drops unavailable vehicles", () => {
    expect(deriveNotifications(input([vehicle()], { memberId: undefined }))).toEqual([]);
    expect(deriveNotifications(input([], { vehicles: undefined }))).toEqual([]);
  });

  it("keeps shared service reminders for a protected member without sensitive expiry reminders", () => {
    const notes = deriveNotifications(input([vehicle({
      plate: null, insuranceUntil: null, inspectionUntil: null, documentId: null,
      canViewHistory: false, canEdit: false, canDelete: false,
    })]));
    expect(notes.map((note) => note.ref)).toEqual([
      { kind: "vehicles", vehicleId: "vehicle-1", reason: "service" },
    ]);
    // Neither the structured payload nor its reference copies private metadata.
    const adultNotes = deriveNotifications(input([vehicle({
      plate: "PRIVATE-PLATE", documentId: "PRIVATE-DOCUMENT", insuranceUntil: "2026-11-16",
    })]));
    expect(JSON.stringify(adultNotes)).not.toContain("PRIVATE-PLATE");
    expect(JSON.stringify(adultNotes)).not.toContain("PRIVATE-DOCUMENT");
    expect(adultNotes.every((note) => Object.keys(note.ref).sort().join() === "kind,reason,vehicleId")).toBe(true);
  });

  it("cannot be dismissed and sorts deterministically across input order", () => {
    const rows = [
      vehicle({ id: "b", serviceDueDate: "2026-11-16" }),
      vehicle({ id: "a", serviceDueDate: "2026-11-16", insuranceUntil: "2026-11-15" }),
    ];
    const notes = deriveNotifications(input(rows));
    expect(notes.every((note) => note.domain === "vehicles" && !note.dismissible)).toBe(true);
    expect(deriveNotifications(input(rows, { dismissed: new Set(notes.map((note) => note.id)) }))).toEqual(notes);
    expect(deriveNotifications(input([...rows].reverse()))).toEqual(notes);
    expect(notes.map((note) => note.id)).toEqual([
      "vehicles:a:insurance:2026-11-15",
      "vehicles:a:service:2026-11-16:none",
      "vehicles:b:service:2026-11-16:none",
    ]);
  });
});
