import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestActivityRepository } from "./activityRepository";
import type { ActivityInput } from "@/domain/activity/activity.types";

afterEach(() => vi.unstubAllGlobals());
const activity = { id: "activity", title: "گردش خانوادگی", note: "توضیح", date: "2026-11-15", location: "پارک", status: "planned", participant_ids: ["child"],
  reminder_enabled: true, created_by: "member-a", revision: 3, created_at: "2026-11-15T08:00:00Z", updated_at: "2026-11-15T09:00:00Z", can_edit: true, can_delete: true };
const input: ActivityInput = { title: "  گردش   خانوادگی  ", note: "  سطر اول\nسطر دوم  ", date: "2026-11-15", location: "  پارک   نزدیک  ", status: "cancelled", participantIds: ["child"], reminderEnabled: false };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function setup() {
  vi.stubGlobal("navigator", { onLine: true }); let token: string | null = "token-a";
  const getToken = vi.fn(async () => token); const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(activity));
  vi.stubGlobal("fetch", fetchMock); const provider = { getToken };
  return { repo: new RestActivityRepository(new RestClient(provider), provider), getToken, fetchMock, setToken: (next: string | null) => { token = next; } };
}
describe("online activity transport", () => {
  it("maps current participants, server capabilities and the same activity identity without extra family metadata", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ activities: [{ ...activity, family_id: "family", kind: "activity" }], can_create: true }));
    expect(await context.repo.list()).toEqual({ activities: [{ id: "activity", title: activity.title, note: activity.note, date: activity.date, location: "پارک", status: "planned",
      participantIds: ["child"], reminderEnabled: true, createdBy: "member-a", revision: 3, createdAt: activity.created_at, updatedAt: activity.updated_at, canEdit: true, canDelete: true }], canCreate: true });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer token-a" } });
  });
  it("does not grant editing privileges to a viewer or a truthy unknown capability", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ ...activity, can_edit: "true", can_delete: false }));
    expect(await context.repo.get("activity")).toMatchObject({ canEdit: false, canDelete: false });
  });
  it("blocks every operation offline before accessing a token or sending data", async () => {
    const context = setup(); vi.stubGlobal("navigator", { onLine: false });
    for (const action of [() => context.repo.list(), () => context.repo.get("activity"), () => context.repo.add(input), () => context.repo.update("activity", input, 3), () => context.repo.remove("activity", 3)])
      await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled(); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("never issues an unauthenticated write after logout", async () => {
    const context = setup(); context.setToken(null); await expect(context.repo.add(input)).rejects.toMatchObject({ code: "SESSION_EXPIRED" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("binds a pending write to the session present at the beginning", async () => {
    const context = setup(); let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input); context.setToken("token-b"); release("token-a"); await saving;
    expect(context.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-a" }); expect(context.getToken).toHaveBeenCalledOnce();
  });
  it("does not send a mutation prepared just before disconnecting", async () => {
    const context = setup(); let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input); vi.stubGlobal("navigator", { onLine: false }); release("token-a");
    await expect(saving).rejects.toMatchObject({ code: "NETWORK" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("sends a complete revision-controlled update without accepting kind, family or creator from the caller", async () => {
    const context = setup(); await context.repo.update("activity/shared", { ...input, kind: "event", familyId: "other", createdBy: "other" } as ActivityInput, 3);
    const [url, request] = context.fetchMock.mock.calls[0]; expect(url).toContain("/activities/activity%2Fshared"); expect(request).toMatchObject({ method: "PATCH", cache: "no-store" });
    expect(JSON.parse(request.body as string)).toEqual({ title: "گردش خانوادگی", note: "سطر اول\nسطر دوم", date: "2026-11-15", location: "پارک نزدیک", status: "cancelled", participant_ids: ["child"], reminder_enabled: false, base_revision: 3 });
  });
  it("uses no-store for detail and deletes through the revision-controlled activity route", async () => {
    const context = setup(); await context.repo.get("activity"); context.fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 })); await context.repo.remove("activity", 3);
    expect(context.fetchMock.mock.calls.map(([url, init]) => ({ url: url.slice(url.indexOf("/activities")), method: init.method, cache: init.cache })))
      .toEqual([{ url: "/activities/activity", method: "GET", cache: "no-store" }, { url: "/activities/activity?base_revision=3", method: "DELETE", cache: "no-store" }]);
  });
  it("surfaces revoked access instead of returning an earlier activity snapshot", async () => {
    const context = setup(); await context.repo.get("activity");
    context.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }));
    await expect(context.repo.get("activity")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 }); expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });
});
