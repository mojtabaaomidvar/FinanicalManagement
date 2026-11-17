import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import type { Goal } from "@/domain/goal/goal.types";
import type { NotificationsModel } from "../model/useNotificationsModel";
import type { TxFormModel } from "@/features/transaction-form";
import { NotificationCenterFeature } from "./NotificationCenterFeature";

const identity = vi.hoisted(() => ({ id: "member-1" }));
vi.mock("@/app/providers/AppProvider", () => ({
  useApp: () => ({
    txs: [], events: [], cur: "تومان", customCategories: [], bills: [], inventory: [], tasks: [],
    member: { id: identity.id, role: "owner" },
  }),
}));
vi.mock("@/shared/ui", () => ({
  Icon: () => null,
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
}));

const goal = (patch: Partial<Goal> = {}): Goal => ({
  id: "goal-1", ownerId: "member-1", kind: "goal", title: "عنوان بسیار خصوصی",
  note: "توضیح بسیار خصوصی", targetDate: "2026-11-15", status: "active",
  reminderEnabled: true, revision: 1,
  createdAt: "2026-11-15T00:00:00Z", updatedAt: "2026-11-15T00:00:00Z", ...patch,
});
const render = (goals: Goal[]) => {
  const m: NotificationsModel = {
    list: [{ id: "goals:goal-1:2026-11-15", domain: "goals", severity: "pending",
      dateIso: "2026-11-15", dismissible: false, ref: { kind: "goals", goalId: "goal-1" } }],
    count: 1, open: true, setOpen: vi.fn(), busy: null, dismiss: vi.fn(), reload: vi.fn(),
    joinRequests: [], documents: [], equipment: [], vehicles: [], goals, activities: [],
  };
  return renderToStaticMarkup(createElement(NotificationCenterFeature, {
    m, form: {} as TxFormModel, joinRequests: [],
    onOpenJoinRequests: vi.fn(), onOpenBills: vi.fn(), onOpenInventory: vi.fn(),
    onOpenTasks: vi.fn(), onOpenDocuments: vi.fn(), onOpenEquipment: vi.fn(),
    onOpenVehicles: vi.fn(), onOpenGoal: vi.fn(),
  }));
};

describe("goal reminder title authorization at render time", () => {
  beforeEach(() => { identity.id = "member-1"; });

  it("renders the authorized owner's title and date without copying the note or a dismissal action", () => {
    const markup = render([goal()]);
    expect(markup).toContain("عنوان بسیار خصوصی");
    expect(markup).toContain("موعد هدف");
    expect(markup).not.toContain("توضیح بسیار خصوصی");
    expect(markup).not.toContain("نادیده بگیر");
  });

  it("hides another member's title even when an old ref and snapshot reach a family owner", () => {
    identity.id = "family-owner";
    expect(render([goal()])).not.toContain("عنوان بسیار خصوصی");
  });

  it("hides labels whose backing item is missing, done, undated or reminder-disabled", () => {
    for (const rows of [[], [goal({ status: "done" })], [goal({ targetDate: null })], [goal({ reminderEnabled: false })]]) {
      expect(render(rows)).not.toContain("عنوان بسیار خصوصی");
    }
  });
});
