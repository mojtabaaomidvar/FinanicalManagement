import { describe, expect, it } from "vitest";
import { filterGoals } from "./goalPresentation";
import type { Goal } from "@/domain/goal/goal.types";

const base: Goal = { id: "goal", ownerId: "member", kind: "goal", title: "یادگیری کتاب", note: "تمرین روزانه",
  status: "active", targetDate: null, reminderEnabled: true, revision: 1, createdAt: "2026-11-15", updatedAt: "2026-11-15" };
describe("goal search and filters", () => {
  it("combines the type, status and note search while accepting Persian and Arabic letter variants", () => {
    const items = [base, { ...base, id: "wish", kind: "wish" as const, status: "done" as const }];
    expect(filterGoals(items, "goal", "active", "يادگيري كتاب").map((goal) => goal.id)).toEqual(["goal"]);
    expect(filterGoals(items, "wish", "done", "تمرین").map((goal) => goal.id)).toEqual(["wish"]);
    expect(filterGoals(items, "wish", "active", "")).toEqual([]);
  });
  it("orders recent updates without mutating the private snapshot", () => {
    const items = [base, { ...base, id: "recent", updatedAt: "2026-11-16" }];
    expect(filterGoals(items, "all", "all", "").map((goal) => goal.id)).toEqual(["recent", "goal"]);
    expect(items[0]).toBe(base);
  });
});
