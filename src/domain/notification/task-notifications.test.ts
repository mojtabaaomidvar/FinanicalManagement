import { describe, expect, it } from "vitest";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";
import type { Task } from "../task/task.types";
import { isoToJalali } from "@/shared/lib/jalali";

const task = (patch: Partial<Task> = {}): Task => ({
  id: "task-1", title: "تعویض فیلتر", description: null, assigneeId: "member-1",
  dueDate: null, completed: false, completedAt: null, completedBy: null,
  createdBy: "member-2", revision: 1, createdAt: "2026-11-14T00:00:00Z",
  updatedAt: "2026-11-14T00:00:00Z", ...patch,
});

const input = (tasks: Task[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  tasks, memberId: "member-1", role: "member", prefs: DEFAULT_NOTIFICATION_PREFS,
  dismissed: new Set(), todayJ: isoToJalali("2026-11-14"), ...patch,
});

describe("task reminders", () => {
  it("notifies only the current assignee about unfinished tasks", () => {
    const notes = deriveNotifications(input([
      task(), task({ id: "other", assigneeId: "member-2" }),
      task({ id: "unassigned", assigneeId: null }), task({ id: "done", completed: true }),
    ]));
    expect(notes.map((note) => note.id)).toEqual(["tasks:task-1"]);
    expect(notes[0]).toMatchObject({ severity: "pending", dismissible: false });
    expect(deriveNotifications(input([task()], { memberId: undefined }))).toEqual([]);
  });

  it("includes today and tomorrow but excludes past and distant assigned tasks", () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, tasks: 3 } };
    const notes = deriveNotifications(input([
      task({ id: "overdue", dueDate: "2026-11-13" }),
      task({ id: "today", dueDate: "2026-11-14" }),
      task({ id: "near", dueDate: "2026-11-15" }),
      task({ id: "later", dueDate: "2026-11-18" }),
    ], { prefs }));
    expect(Object.fromEntries(notes.map((note) => [note.id, note.severity]))).toEqual({
      "tasks:today": "pending", "tasks:near": "soon",
    });
  });

  it("removes a reminder on completion, deletion or reassignment", () => {
    expect(deriveNotifications(input([task({ completed: true })]))).toEqual([]);
    expect(deriveNotifications(input([]))).toEqual([]);
    expect(deriveNotifications(input([task({ assigneeId: "member-2" })]))).toEqual([]);
    expect(deriveNotifications(input([task({ revision: 2 })]))[0].id).toBe("tasks:task-1");
  });

  it("honors the task toggle and the global notification toggle", () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, tasks: false } };
    expect(deriveNotifications(input([task()], { prefs }))).toEqual([]);
    expect(deriveNotifications(input([task()], {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false },
    }))).toEqual([]);
  });
});
