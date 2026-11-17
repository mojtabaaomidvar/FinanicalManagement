import { describe, expect, it } from "vitest";
import type { Goal } from "@/domain/goal/goal.types";
import { isoToJalali } from "@/shared/lib/jalali";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";

const goal = (patch: Partial<Goal> = {}): Goal => ({
  id: "goal-1", kind: "goal", title: "عنوان خصوصی", note: "شرح خصوصی",
  targetDate: "2026-11-22", status: "active", reminderEnabled: true,
  ownerId: "member-1", revision: 1,
  createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", ...patch,
});
const input = (rows: Goal[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  goals: rows, memberId: "member-1", role: "member", prefs: DEFAULT_NOTIFICATION_PREFS,
  dismissed: new Set(), todayJ: isoToJalali("2026-11-15"), ...patch,
});

describe("private goal and wish reminders", () => {
  it("defaults to seven days and handles overdue, today and the exact boundary", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.domains.goals).toBe(true);
    expect(DEFAULT_NOTIFICATION_PREFS.leadDays.goals).toBe(7);
    const notes = deriveNotifications(input([
      goal({ id: "past", targetDate: "2026-11-14" }),
      goal({ id: "today", targetDate: "2026-11-15", kind: "wish" }),
      goal({ id: "boundary", targetDate: "2026-11-22" }),
      goal({ id: "beyond", targetDate: "2026-11-23" }),
    ]));
    expect(notes.map((note) => [note.ref, note.severity])).toEqual([
      [{ kind: "goals", goalId: "past" }, "overdue"],
      [{ kind: "goals", goalId: "today" }, "pending"],
      [{ kind: "goals", goalId: "boundary" }, "soon"],
    ]);
  });

  it("denies other owners even to family owners and admins, and fails closed without identity", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(deriveNotifications(input([goal({ ownerId: "member-2" })], { role }))).toEqual([]);
    }
    expect(deriveNotifications(input([goal()], { memberId: undefined }))).toEqual([]);
    const rows = [goal({ id: "mine" }), goal({ id: "theirs", ownerId: "member-2" })];
    expect(deriveNotifications(input(rows)).map((note) => note.ref)).toEqual([{ kind: "goals", goalId: "mine" }]);
    expect(deriveNotifications(input(rows, { memberId: "member-2" })).map((note) => note.ref)).toEqual([{ kind: "goals", goalId: "theirs" }]);
  });

  it("requires an active item, date and item reminder, and reopening restores the reminder", () => {
    for (const patch of [{ status: "done" }, { targetDate: null }, { reminderEnabled: false }] as Partial<Goal>[]) {
      expect(deriveNotifications(input([goal(patch)]))).toEqual([]);
    }
    expect(deriveNotifications(input([goal({ status: "active" })]))).toHaveLength(1);
    expect(deriveNotifications(input([]))).toEqual([]);
  });

  it("honors domain/global controls and leaves other domains intact", () => {
    const domainOff = { ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, goals: false } };
    const tasks: NonNullable<DeriveInput["tasks"]> = [{
      id: "task-1", title: "کار خانه", description: null, assigneeId: "member-1", dueDate: null,
      completed: false, completedAt: null, completedBy: null, createdBy: "member-1", revision: 1,
      createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z",
    }];
    expect(deriveNotifications(input([goal()], { prefs: domainOff, tasks })).map((note) => note.domain)).toEqual(["tasks"]);
    expect(deriveNotifications(input([goal()], {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false }, tasks,
    }))).toEqual([]);
  });

  it("applies custom lead days and defensive bounds without omitting overdue items", () => {
    const prefs = (lead: number) => ({ ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, goals: lead } });
    for (const lead of [0, -1, NaN, Infinity]) {
      const notes = deriveNotifications(input([
        goal({ id: "past", targetDate: "2026-11-14" }),
        goal({ id: "today", targetDate: "2026-11-15" }),
        goal({ id: "tomorrow", targetDate: "2026-11-16" }),
      ], { prefs: prefs(lead) }));
      expect(notes.map((note) => note.ref)).toEqual([
        { kind: "goals", goalId: "past" }, { kind: "goals", goalId: "today" },
      ]);
    }
    expect(deriveNotifications(input([goal({ targetDate: "2026-11-16" })], { prefs: prefs(1.9) }))).toHaveLength(1);
    expect(deriveNotifications(input([goal({ targetDate: "2026-11-17" })], { prefs: prefs(1.9) }))).toEqual([]);
    expect(deriveNotifications(input([goal({ targetDate: "2027-01-15" })], { prefs: prefs(999) }))).toEqual([]);
  });

  it("keeps only an ID reference and never copies private title, description or ownership", () => {
    const notes = deriveNotifications(input([goal()]));
    expect(notes[0].ref).toEqual({ kind: "goals", goalId: "goal-1" });
    const serialized = JSON.stringify(notes);
    expect(serialized).not.toContain("عنوان خصوصی");
    expect(serialized).not.toContain("شرح خصوصی");
    expect(serialized).not.toContain("member-1");
  });

  it("cannot be dismissed and sorts deterministically independent of input order", () => {
    const rows = [goal({ id: "b" }), goal({ id: "a" })];
    const notes = deriveNotifications(input(rows));
    expect(notes.every((note) => !note.dismissible)).toBe(true);
    expect(deriveNotifications(input(rows, { dismissed: new Set(notes.map((note) => note.id)) }))).toEqual(notes);
    expect(deriveNotifications(input([...rows].reverse()))).toEqual(notes);
    expect(notes.map((note) => note.id)).toEqual(["goals:a:2026-11-22", "goals:b:2026-11-22"]);
  });

  it("replaces a reminder when the target changes and preserves it when the kind changes", () => {
    const original = deriveNotifications(input([goal()]))[0];
    expect(deriveNotifications(input([goal({ kind: "wish" })]))[0]).toEqual(original);
    expect(deriveNotifications(input([goal({ targetDate: "2026-11-21" })]))[0].id).not.toBe(original.id);
    expect(deriveNotifications(input([goal({ targetDate: "2027-01-15" })]))).toEqual([]);
  });
});
