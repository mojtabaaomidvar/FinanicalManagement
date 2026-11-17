import { describe, expect, it } from "vitest";
import { activityError, activityInput, activityParticipants, isActivityDay } from "./activity.rules";
import type { Activity, ActivityInput } from "./activity.types";
import type { Member } from "@/domain/family/family.types";

const input: ActivityInput = { title: "گردش خانوادگی", date: "2020-02-29", status: "planned", participantIds: [], reminderEnabled: true };
const member = (id: string, status: Member["status"], membershipState: Member["membershipState"], familyId = "family") => ({ id, status, membershipState, familyId }) as Member;
describe("family activity rules", () => {
  it("permits past dates, no participants and every supported status", () => {
    for (const status of ["planned", "done", "cancelled"] as const) expect(activityError({ ...input, status })).toBe("");
  });
  it("requires an actual calendar day without a time", () => {
    expect(isActivityDay("2024-02-29")).toBe(true);
    for (const date of ["", "2026-02-29", "2026-11-15T12:00:00Z", "2026-2-3"]) expect(activityError({ ...input, date })).not.toBe("");
  });
  it("enforces title, note and location limits", () => {
    expect(activityError({ ...input, title: " " })).not.toBe("");
    expect(activityError({ ...input, title: "ا".repeat(120), note: "ب".repeat(2000), location: "پ".repeat(180) })).toBe("");
    for (const extra of [{ title: "ا".repeat(121) }, { note: "ب".repeat(2001) }, { location: "پ".repeat(181) }]) expect(activityError({ ...input, ...extra })).not.toBe("");
  });
  it("limits participants to 50 distinct current family members", () => {
    const participants = Array.from({ length: 50 }, (_, index) => `member-${index}`);
    expect(activityError({ ...input, participantIds: participants }, participants)).toBe("");
    for (const participantIds of [["member", "member"], [""], [...participants, "extra"], ["foreign"]]) expect(activityError({ ...input, participantIds }, participants)).not.toBe("");
  });
  it("includes introduced children while excluding inactive or foreign family membership", () => {
    const members = [member("adult", "active", "active"), member("introduced-child", "pending", "active"),
      member("suspended", "active", "suspended"), member("waiting", "active", "pending"), member("unknown", "active", null), member("foreign", "active", "active", "other")];
    expect(activityParticipants(members, "family").map((row) => row.id)).toEqual(["adult", "introduced-child"]);
  });
  it("rejects an unsupported status or a non-boolean reminder", () => {
    expect(activityError({ ...input, status: "active" } as unknown as ActivityInput)).not.toBe("");
    expect(activityError({ ...input, reminderEnabled: 1 } as unknown as ActivityInput)).not.toBe("");
  });
  it("preserves date, location, participants and reminder in a status update without mutating its snapshot", () => {
    const activity: Activity = { ...input, id: "activity", note: "سطر اول\nسطر دوم", location: "پارک", participantIds: ["child"],
      createdBy: "creator", revision: 3, createdAt: "2026-11-15", updatedAt: "2026-11-15", canEdit: true, canDelete: true };
    const body = { ...activityInput(activity), status: "cancelled" };
    expect(body).toEqual({ title: input.title, note: activity.note, date: input.date, location: "پارک", participantIds: ["child"], reminderEnabled: true, status: "cancelled" });
    body.participantIds.push("adult"); expect(activity.participantIds).toEqual(["child"]);
  });
});
