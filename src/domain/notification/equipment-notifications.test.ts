import { describe, expect, it } from "vitest";
import type { Equipment } from "@/domain/equipment/equipment.types";
import { isoToJalali } from "@/shared/lib/jalali";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";

const equipment = (patch: Partial<Equipment> = {}): Equipment => ({
  id: "equipment-1", title: "کولر", brand: null, model: null,
  purchaseDate: null, warrantyUntil: null, warrantyDocumentId: null,
  serviceTaskId: null, serviceDueDate: "2026-11-16", serviceReminderEnabled: true,
  createdBy: "member-1", revision: 1, createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z", canEdit: true, canDelete: true, ...patch,
});

const input = (rows: Equipment[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  equipment: rows, memberId: "member-1", role: "member",
  prefs: DEFAULT_NOTIFICATION_PREFS, dismissed: new Set(),
  todayJ: isoToJalali("2026-11-15"), ...patch,
});

describe("equipment service and warranty reminders", () => {
  it("shows today and tomorrow and excludes historical and distant service dates", () => {
    const notes = deriveNotifications(input([
      equipment({ id: "past", serviceDueDate: "2026-11-14" }),
      equipment({ id: "today", serviceDueDate: "2026-11-15" }),
      equipment({ id: "boundary", serviceDueDate: "2026-11-16" }),
      equipment({ id: "beyond", serviceDueDate: "2026-11-17" }),
    ]));
    expect(notes.map((note) => [note.ref, note.severity])).toEqual([
      [{ kind: "equipment", equipmentId: "today", reason: "service" }, "pending"],
      [{ kind: "equipment", equipmentId: "boundary", reason: "service" }, "soon"],
    ]);
    expect(notes.every((note) => note.domain === "equipment" && !note.dismissible)).toBe(true);
  });

  it("has separate service and warranty reminders even when their dates match", () => {
    const item = equipment({ warrantyUntil: "2026-11-16" });
    expect(deriveNotifications(input([item])).map((note) => note.id)).toEqual([
      "equipment:equipment-1:service:2026-11-16",
      "equipment:equipment-1:warranty:2026-11-16",
    ]);
  });

  it("keeps warranty reminders when the item's service reminder is switched off", () => {
    const notes = deriveNotifications(input([equipment({
      serviceReminderEnabled: false, warrantyUntil: "2026-11-16",
    })]));
    expect(notes.map((note) => note.ref)).toEqual([
      { kind: "equipment", equipmentId: "equipment-1", reason: "warranty" },
    ]);
    expect(deriveNotifications(input([equipment({ serviceDueDate: null })]))).toEqual([]);
    expect(deriveNotifications(input([equipment({ serviceReminderEnabled: false })]))).toEqual([]);
  });

  it("requires a current member and omits reminders when equipment is unavailable", () => {
    expect(deriveNotifications(input([equipment()], { memberId: undefined }))).toEqual([]);
    expect(deriveNotifications(input([], { equipment: undefined }))).toEqual([]);
  });

  it("respects the domain and global controls without changing other domains", () => {
    const domainOff = {
      ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, equipment: false },
    };
    expect(deriveNotifications(input([equipment()], { prefs: domainOff }))).toEqual([]);
    expect(deriveNotifications(input([equipment()], {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false },
    }))).toEqual([]);
  });

  it("keeps the today and tomorrow window despite legacy zero invalid or excessive leads", () => {
    const prefs = (lead: number) => ({
      ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, equipment: lead },
    });
    for (const lead of [0, -1, NaN, Infinity]) {
      const notes = deriveNotifications(input([
        equipment({ id: "today", serviceDueDate: "2026-11-15" }),
        equipment({ id: "tomorrow", serviceDueDate: "2026-11-16" }),
      ], { prefs: prefs(lead) }));
      expect(notes.map((note) => note.id)).toEqual(["equipment:today:service:2026-11-15", "equipment:tomorrow:service:2026-11-16"]);
    }
    const far = equipment({ serviceDueDate: "2027-01-15" });
    expect(deriveNotifications(input([far], { prefs: prefs(999) }))).toEqual([]);
  });

  it("replaces the old service reminder after service changes the next due date", () => {
    const original = equipment({ serviceDueDate: "2026-11-15", warrantyUntil: "2026-11-16" });
    expect(deriveNotifications(input([original]))).toHaveLength(2);
    const changed = { ...original, serviceDueDate: "2026-12-15", revision: 2 };
    const notes = deriveNotifications(input([changed]));
    expect(notes.map((note) => note.ref)).toEqual([
      { kind: "equipment", equipmentId: "equipment-1", reason: "warranty" },
    ]);
    expect(deriveNotifications(input([{ ...changed, warrantyUntil: null, serviceDueDate: null }]))).toEqual([]);
  });

  it("orders equal severity by date then deterministic id, independent of input order", () => {
    const rows = [
      equipment({ id: "b", serviceDueDate: "2026-11-16" }),
      equipment({ id: "a", serviceDueDate: "2026-11-16", warrantyUntil: "2026-11-15" }),
    ];
    const expected = deriveNotifications(input(rows));
    expect(deriveNotifications(input([...rows].reverse()))).toEqual(expected);
    expect(expected.map((note) => note.id)).toEqual([
      "equipment:a:warranty:2026-11-15",
      "equipment:a:service:2026-11-16",
      "equipment:b:service:2026-11-16",
    ]);
  });
});
