import { describe, expect, it } from "vitest";
import type { Activity } from "@/domain/activity/activity.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import { isoToJalali } from "@/shared/lib/jalali";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";

const activity = (patch: Partial<Activity> = {}): Activity => ({
  id: "activity-1", title: "برنامهٔ خانوادگی", note: "شرح برنامه", date: "2026-11-22",
  location: "مکان برنامه", status: "planned", participantIds: ["member-2"], reminderEnabled: true,
  createdBy: "member-2", revision: 1, createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z", canEdit: false, canDelete: false, ...patch,
});
const input = (rows: Activity[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  activities: rows, memberId: "member-1", role: "member", prefs: DEFAULT_NOTIFICATION_PREFS,
  dismissed: new Set(), todayJ: isoToJalali("2026-11-15"), ...patch,
});
const event = (patch: Partial<FamilyEvent> = {}): FamilyEvent => ({
  id: "activity-1", familyId: "family-1", memberId: "member-2", forMemberId: null,
  title: "برنامهٔ خانوادگی", date: "2026-11-22", note: null, createdAt: "2026-11-15T00:00:00Z",
  kind: "activity", activityStatus: "planned", reminderEnabled: true, revision: 1,
  ...patch,
});

describe("canonical family activity reminders", () => {
  it("defaults to seven days and includes overdue, today and the exact lead boundary", () => {
    expect(DEFAULT_NOTIFICATION_PREFS.leadDays.activities).toBe(7);
    const notes = deriveNotifications(input([
      activity({ id: "past", date: "2026-11-14" }), activity({ id: "today", date: "2026-11-15" }),
      activity({ id: "boundary", date: "2026-11-22" }), activity({ id: "beyond", date: "2026-11-23" }),
    ]));
    expect(notes.map((note) => [note.ref, note.severity])).toEqual([
      [{ kind: "activities", activityId: "past" }, "overdue"],
      [{ kind: "activities", activityId: "today" }, "pending"],
      [{ kind: "activities", activityId: "boundary" }, "soon"],
    ]);
  });

  it("excludes completed, cancelled and reminder-disabled programs and restores planned ones", () => {
    for (const patch of [{ status: "done" }, { status: "cancelled" }, { reminderEnabled: false }] as Partial<Activity>[]) {
      expect(deriveNotifications(input([activity(patch)]))).toEqual([]);
    }
    expect(deriveNotifications(input([activity({ status: "planned" })]))).toHaveLength(1);
    expect(deriveNotifications(input([]))).toEqual([]);
  });

  it("shows authorized shared plans for all roles regardless of creator, participants or edit capability", () => {
    for (const role of ["owner", "admin", "member"] as const) {
      expect(deriveNotifications(input([activity()], { role }))).toHaveLength(1);
    }
    expect(deriveNotifications(input([activity()], { memberId: undefined }))).toEqual([]);
  });

  it("does not duplicate an activity present in the canonical events calendar", () => {
    const notes = deriveNotifications(input([activity()], { events: [event()] }));
    expect(notes).toHaveLength(1);
    expect(notes[0].domain).toBe("activities");
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, activities: false } };
    expect(deriveNotifications(input([activity()], { events: [event()], prefs }))).toEqual([]);
    for (const status of ["done", "cancelled"] as const) {
      expect(deriveNotifications(input([activity({ status })], { events: [event({ activityStatus: status })] }))).toEqual([]);
    }
  });

  it("preserves legacy event reminders and their existing dismissal behavior", () => {
    const legacy = event({ id: "event-1", kind: "event", activityStatus: null });
    const notes = deriveNotifications(input([activity()], { events: [legacy, event()] }));
    expect(notes.map((note) => note.domain).sort()).toEqual(["activities", "event"]);
    const eventNote = notes.find((note) => note.domain === "event")!;
    expect(eventNote.dismissible).toBe(true);
    expect(deriveNotifications(input([activity()], { events: [legacy], dismissed: new Set([eventNote.id]) })).map((note) => note.domain)).toEqual(["activities"]);
  });

  it("honors activity/global controls without changing old event preferences", () => {
    const legacy = event({ id: "event-1", kind: "event", activityStatus: null });
    const activitiesOff = { ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, activities: false } };
    const eventsOff = { ...DEFAULT_NOTIFICATION_PREFS,
      domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, event: false } };
    expect(deriveNotifications(input([activity()], { events: [legacy], prefs: activitiesOff })).map((note) => note.domain)).toEqual(["event"]);
    expect(deriveNotifications(input([activity()], { events: [legacy], prefs: eventsOff })).map((note) => note.domain)).toEqual(["activities"]);
    expect(deriveNotifications(input([activity()], { prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false } }))).toEqual([]);
  });

  it("uses custom lead days and defensive bounds while retaining overdue items", () => {
    const prefs = (lead: number) => ({ ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, activities: lead } });
    for (const lead of [0, -1, NaN, Infinity]) {
      expect(deriveNotifications(input([
        activity({ id: "past", date: "2026-11-14" }), activity({ id: "tomorrow", date: "2026-11-16" }),
      ], { prefs: prefs(lead) })).map((note) => note.ref)).toEqual([{ kind: "activities", activityId: "past" }]);
    }
    expect(deriveNotifications(input([activity({ date: "2026-11-16" })], { prefs: prefs(1.9) }))).toHaveLength(1);
    expect(deriveNotifications(input([activity({ date: "2026-11-17" })], { prefs: prefs(1.9) }))).toEqual([]);
    expect(deriveNotifications(input([activity({ date: "2027-01-15" })], { prefs: prefs(999) }))).toEqual([]);
  });

  it("keeps ID-only references without copying title, note, place, creator or participants", () => {
    const notes = deriveNotifications(input([activity()]));
    expect(notes[0].ref).toEqual({ kind: "activities", activityId: "activity-1" });
    for (const value of ["برنامهٔ خانوادگی", "شرح برنامه", "مکان برنامه", "member-2"]) {
      expect(JSON.stringify(notes)).not.toContain(value);
    }
  });

  it("cannot be dismissed, sorts deterministically, and replaces the reference when date changes", () => {
    const rows = [activity({ id: "b" }), activity({ id: "a" })];
    const notes = deriveNotifications(input(rows));
    expect(notes.every((note) => !note.dismissible)).toBe(true);
    expect(deriveNotifications(input(rows, { dismissed: new Set(notes.map((note) => note.id)) }))).toEqual(notes);
    expect(deriveNotifications(input([...rows].reverse()))).toEqual(notes);
    expect(deriveNotifications(input([activity({ id: "a", date: "2026-11-21" })]))[0].id).not.toBe(notes[0].id);
  });
});
