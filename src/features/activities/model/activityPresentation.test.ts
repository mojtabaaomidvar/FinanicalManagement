import { describe, expect, it } from "vitest";
import { activityStatusLabel, filterActivities } from "./activityPresentation";
import type { Activity } from "@/domain/activity/activity.types";

const item: Activity = { id: "activity", title: "گردش", note: "با خانواده", date: "2026-11-15", location: "پارک", status: "planned", participantIds: [],
  reminderEnabled: true, createdBy: "creator", revision: 1, createdAt: "2026-11-15", updatedAt: "2026-11-15", canEdit: false, canDelete: false };
describe("activity search and status", () => {
  it("combines status with title, note or location search and normalizes Persian letters", () => {
    const items = [item, { ...item, id: "done", status: "done" as const }];
    expect(filterActivities(items, "planned", "پارك").map((row) => row.id)).toEqual(["activity"]);
    expect(filterActivities(items, "done", "خانواده").map((row) => row.id)).toEqual(["done"]);
    expect(filterActivities(items, "cancelled", "گردش")).toEqual([]);
  });
  it("retains cancelled and completed rows with their explicit status and leaves input ordering intact", () => {
    const items = [item, { ...item, id: "next", date: "2026-11-16", status: "cancelled" as const }];
    expect(filterActivities(items, "all", "").map((row) => row.id)).toEqual(["next", "activity"]);
    expect(items[0]).toBe(item); expect(activityStatusLabel("cancelled")).toBe("لغوشده"); expect(activityStatusLabel("done")).toBe("انجام‌شده");
  });
});
