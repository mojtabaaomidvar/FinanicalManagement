import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactNode } from "react";
import type { Activity } from "@/domain/activity/activity.types";
import type { NotificationsModel } from "../model/useNotificationsModel";
import type { TxFormModel } from "@/features/transaction-form";
import { NotificationCenterFeature } from "./NotificationCenterFeature";

vi.mock("@/app/providers/AppProvider", () => ({
  useApp: () => ({ txs: [], events: [], cur: "تومان", customCategories: [], bills: [], inventory: [], tasks: [],
    member: { id: "member-1", role: "member" } }),
}));
vi.mock("@/shared/ui", () => ({
  Icon: () => null,
  Modal: ({ open, children }: { open: boolean; children: ReactNode }) => open ? children : null,
}));
const activity = (patch: Partial<Activity> = {}): Activity => ({
  id: "activity-1", title: "برنامهٔ مشترک مجاز", note: "توضیح برنامه", location: "مکان برنامه",
  date: "2026-11-15", status: "planned", participantIds: ["member-2"], reminderEnabled: true,
  createdBy: "member-2", revision: 1, createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z", canEdit: false, canDelete: false, ...patch,
});
const render = (activities: Activity[]) => {
  const m: NotificationsModel = {
    list: [{ id: "activities:activity-1:2026-11-15", domain: "activities", severity: "pending",
      dateIso: "2026-11-15", dismissible: false, ref: { kind: "activities", activityId: "activity-1" } }],
    count: 1, open: true, setOpen: vi.fn(), busy: null, dismiss: vi.fn(), reload: vi.fn(),
    joinRequests: [], documents: [], equipment: [], vehicles: [], goals: [], activities,
  };
  return renderToStaticMarkup(createElement(NotificationCenterFeature, {
    m, form: {} as TxFormModel, joinRequests: [],
    onOpenJoinRequests: vi.fn(), onOpenBills: vi.fn(), onOpenInventory: vi.fn(),
    onOpenTasks: vi.fn(), onOpenDocuments: vi.fn(), onOpenEquipment: vi.fn(),
    onOpenVehicles: vi.fn(), onOpenActivity: vi.fn(),
  }));
};

describe("authorized activity reminder labels", () => {
  it("renders the title and date for a shared plan without note, place, participants or dismissal", () => {
    const markup = render([activity()]);
    expect(markup).toContain("برنامهٔ مشترک مجاز");
    expect(markup).not.toContain("توضیح برنامه");
    expect(markup).not.toContain("مکان برنامه");
    expect(markup).not.toContain("member-2");
    expect(markup).not.toContain("نادیده بگیر");
  });

  it("cannot resolve a stale ref after the authorized snapshot is erased", () => {
    expect(render([])).not.toContain("برنامهٔ مشترک مجاز");
  });

  it("hides labels for done, cancelled and reminder-disabled plans", () => {
    for (const patch of [{ status: "done" }, { status: "cancelled" }, { reminderEnabled: false }] as Partial<Activity>[]) {
      expect(render([activity(patch)])).not.toContain("برنامهٔ مشترک مجاز");
    }
  });
});
