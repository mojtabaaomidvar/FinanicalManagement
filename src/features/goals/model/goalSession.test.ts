import { describe, expect, it } from "vitest";
import { GoalSession } from "./goalSession";
import type { Goal } from "@/domain/goal/goal.types";

const goal: Goal = { id: "private", ownerId: "owner", kind: "goal", title: "یادداشت خصوصی", note: null,
  targetDate: null, status: "active", reminderEnabled: true, revision: 1, createdAt: "2026-11-15", updatedAt: "2026-11-15" };

describe("private goal response lifecycle", () => {
  it("only admits the active owner's rows, including an active child owner", () => {
    const session = new GoalSession();
    session.setScope("owner:family", "owner");
    const ticket = session.capture();
    expect(session.owns(ticket, goal)).toBe(true);
    expect(session.owns(ticket, { ...goal, ownerId: "other-member" })).toBe(false);
    session.setScope("child:family", "child");
    expect(session.owns(session.capture(), { ...goal, ownerId: "child" })).toBe(true);
  });
  it("discards the old owner's pending list or mutation response after an identity switch", () => {
    const session = new GoalSession();
    session.setScope("owner:family", "owner");
    const request = session.capture();
    session.setScope("other:family", "other");
    expect(session.isCurrent(request)).toBe(false);
    expect(session.owns(request, goal)).toBe(false);
  });
  it("cannot revive an old form or delayed response after reconnecting with the same account", () => {
    const session = new GoalSession();
    session.setScope("owner:family", "owner");
    const beforeDisconnect = session.capture();
    session.invalidate();
    session.setScope("", "");
    session.setScope("owner:family", "owner");
    expect(session.isCurrent(beforeDisconnect)).toBe(false);
    expect(session.owns(beforeDisconnect, goal)).toBe(false);
    expect(session.owns(session.capture(), goal)).toBe(true);
  });
  it("revokes previous snapshots immediately on a permission denial or unmount", () => {
    const session = new GoalSession();
    session.setScope("owner:family", "owner");
    const authorized = session.capture();
    session.invalidate();
    expect(session.isCurrent(authorized)).toBe(false);
    const pending = session.capture();
    session.close();
    expect(session.isCurrent(pending)).toBe(false);
    expect(session.isCurrent(session.capture())).toBe(false);
  });
});
