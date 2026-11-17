import { describe, expect, it } from "vitest";
import { goalError, goalInput, isGoalDay } from "./goal.rules";
import type { Goal, GoalInput } from "./goal.types";

const input: GoalInput = { kind: "goal", title: "یادگیری زبان", status: "active", reminderEnabled: true };
describe("personal goal validation", () => {
  it("allows goals and wishes without a date and with a past valid date", () => {
    expect(goalError(input)).toBe("");
    expect(goalError({ ...input, kind: "wish", targetDate: "2020-02-29" })).toBe("");
  });
  it("rejects impossible calendar days and timestamps", () => {
    expect(isGoalDay("2026-02-29")).toBe(false);
    expect(isGoalDay("2024-02-29")).toBe(true);
    for (const targetDate of ["2026-02-30", "2026-11-15T12:00:00Z", "2026-1-1"]) expect(goalError({ ...input, targetDate })).not.toBe("");
  });
  it("enforces the title and personal-note boundaries after outer trimming", () => {
    expect(goalError({ ...input, title: "   " })).not.toBe("");
    expect(goalError({ ...input, title: "الف".repeat(41) })).not.toBe("");
    expect(goalError({ ...input, title: "  " + "ا".repeat(120) + "  ", note: "ب".repeat(2000) })).toBe("");
    expect(goalError({ ...input, note: "ب".repeat(2001) })).not.toBe("");
  });
  it("does not accept unknown kinds, statuses or a truthy non-boolean reminder", () => {
    expect(goalError({ ...input, kind: "shared" } as unknown as GoalInput)).not.toBe("");
    expect(goalError({ ...input, status: "deleted" } as unknown as GoalInput)).not.toBe("");
    expect(goalError({ ...input, reminderEnabled: 1 } as unknown as GoalInput)).not.toBe("");
  });
  it("preserves all fields when preparing a complete or reopen update", () => {
    const goal: Goal = { ...input, id: "goal", ownerId: "child", kind: "wish", note: "سطر اول\nسطر دوم", targetDate: "2027-01-01",
      status: "done", revision: 4, createdAt: "2026-11-15T08:00:00Z", updatedAt: "2026-11-15T09:00:00Z" };
    expect({ ...goalInput(goal), status: "active" }).toEqual({ kind: "wish", title: input.title, note: goal.note,
      targetDate: goal.targetDate, status: "active", reminderEnabled: true });
  });
});
