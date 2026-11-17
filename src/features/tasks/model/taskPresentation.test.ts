import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/task/task.types";
import {
  canAssignOffline, canCompleteTask, canEditTask, filterTasks, isTaskOverdue, isTaskAssignee,
} from "./taskPresentation";

const task: Task = {
  id: "task", title: "تعویض فیلتر", description: null, assigneeId: "assignee",
  dueDate: "2026-11-14", completed: false, completedAt: null, completedBy: null,
  createdBy: "creator", revision: 1, createdAt: "2026-11-13T08:00:00Z",
  updatedAt: "2026-11-13T08:00:00Z",
};

describe("task permissions and day filters", () => {
  it("accepts introduced children with active membership and excludes pending join requests", () => {
    expect(isTaskAssignee({ status: "pending", membershipState: "active", relation: "فرزند" })).toBe(true);
    expect(isTaskAssignee({ status: "pending", membershipState: "active", relation: "همسر" })).toBe(false);
    expect(isTaskAssignee({ status: "active", membershipState: "pending", relation: "فرزند" })).toBe(false);
    expect(isTaskAssignee({ status: "pending", membershipState: "suspended", relation: "فرزند" })).toBe(false);
    expect(isTaskAssignee({ status: "active", membershipState: null, relation: "فرزند" })).toBe(false);
    expect(isTaskAssignee({ status: "active", membershipState: "active", relation: "همسر" })).toBe(true);
  });
  it("keeps today's task out of overdue and compares ISO dates across months", () => {
    expect(isTaskOverdue(task, "2026-11-14")).toBe(false);
    expect(isTaskOverdue(task, "2026-11-15")).toBe(true);
    expect(isTaskOverdue({ ...task, dueDate: "2026-10-31" }, "2026-11-01")).toBe(true);
    expect(isTaskOverdue({ ...task, completed: true }, "2026-11-15")).toBe(false);
    expect(isTaskOverdue({ ...task, dueDate: null }, "2026-11-15")).toBe(false);
  });

  it("shows only unfinished assigned tasks in mine and completed tasks separately", () => {
    const completed = { ...task, id: "done", completed: true };
    const other = { ...task, id: "other", assigneeId: "other" };
    expect(filterTasks([task, completed, other], "mine", "assignee", "2026-11-14"))
      .toEqual([task]);
    expect(filterTasks([task, completed, other], "completed", "assignee", "2026-11-14"))
      .toEqual([completed]);
  });

  it("allows creator changes and assignee completion but rejects unrelated members", () => {
    expect(canEditTask(task, { id: "creator", role: "member" }, true)).toBe(true);
    expect(canEditTask(task, { id: "assignee", role: "member" }, false)).toBe(false);
    expect(canCompleteTask(task, { id: "assignee", role: "member" }, true)).toBe(true);
    expect(canCompleteTask(task, { id: "other", role: "member" }, false)).toBe(false);
    expect(canCompleteTask(task, null, false)).toBe(false);
  });

  it.each(["owner", "admin"])("enables %s management online without trusting an offline role", (role) => {
    const actor = { id: "manager", role };
    expect(canEditTask(task, actor, false)).toBe(true);
    expect(canCompleteTask(task, actor, false)).toBe(true);
    expect(canEditTask(task, actor, true)).toBe(false);
    expect(canCompleteTask(task, actor, true)).toBe(false);
  });

  it("permits self, nobody or the original assignee offline and rejects a new peer", () => {
    expect(canAssignOffline(null, "me", "current")).toBe(true);
    expect(canAssignOffline("me", "me", "current")).toBe(true);
    expect(canAssignOffline("current", "me", "current")).toBe(true);
    expect(canAssignOffline("other", "me", "current")).toBe(false);
    expect(canAssignOffline("other", "me", null)).toBe(false);
  });
});
