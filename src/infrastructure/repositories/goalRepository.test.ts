import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestGoalRepository } from "./goalRepository";
import type { GoalInput } from "@/domain/goal/goal.types";

afterEach(() => vi.unstubAllGlobals());
const goal = { id: "goal", owner_id: "member-a", kind: "goal", title: "یادگیری زبان", note: "یادداشت خصوصی",
  target_date: "2027-01-01", status: "active", reminder_enabled: true, revision: 3,
  created_at: "2026-11-15T08:00:00Z", updated_at: "2026-11-15T09:00:00Z" };
const input: GoalInput = { kind: "wish", title: "  یادگیری   زبان  ", note: "  سطر اول\nسطر دوم  ", targetDate: "2027-01-01", status: "done", reminderEnabled: false };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function setup() {
  vi.stubGlobal("navigator", { onLine: true });
  let token: string | null = "token-a";
  const getToken = vi.fn(async () => token);
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(goal));
  vi.stubGlobal("fetch", fetchMock);
  const provider = { getToken };
  return { repo: new RestGoalRepository(new RestClient(provider), provider), getToken, fetchMock, setToken: (next: string | null) => { token = next; } };
}

describe("online private goal transport", () => {
  it("maps only the public contract and does not expose ciphertext or family fields", async () => {
    const context = setup();
    context.fetchMock.mockImplementationOnce(async () => response({ goals: [{ ...goal, encrypted_content: "secret", family_id: "family" }], can_create: true }));
    expect(await context.repo.list()).toEqual({ goals: [{ id: goal.id, ownerId: goal.owner_id, kind: goal.kind, title: goal.title,
      note: goal.note, targetDate: goal.target_date, status: goal.status, reminderEnabled: true, revision: 3,
      createdAt: goal.created_at, updatedAt: goal.updated_at }], canCreate: true });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer token-a" } });
  });
  it("rejects every operation offline before accessing a token or issuing a request", async () => {
    const context = setup();
    vi.stubGlobal("navigator", { onLine: false });
    for (const action of [() => context.repo.list(), () => context.repo.get("goal"), () => context.repo.add(input),
      () => context.repo.update("goal", input, 3), () => context.repo.remove("goal", 3)]) await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled(); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("never issues a request when logout removed the session", async () => {
    const context = setup(); context.setToken(null);
    await expect(context.repo.add(input)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("pins an operation to the starting session while token preparation is pending", async () => {
    const context = setup();
    let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input); context.setToken("token-b"); release("token-a");
    expect(await saving).toMatchObject({ ownerId: "member-a" });
    expect(context.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect(context.getToken).toHaveBeenCalledOnce();
  });
  it("does not send a prepared mutation if the device disconnected while waiting for its token", async () => {
    const context = setup(); let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input); vi.stubGlobal("navigator", { onLine: false }); release("token-a");
    await expect(saving).rejects.toMatchObject({ code: "NETWORK" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("sends a complete revision-controlled update while omitting forged ownership fields", async () => {
    const context = setup();
    await context.repo.update("goal/private", { ...input, ownerId: "other", familyId: "other-family" } as GoalInput, 3);
    const [url, request] = context.fetchMock.mock.calls[0];
    expect(url).toContain("/goals/goal%2Fprivate");
    expect(request).toMatchObject({ method: "PATCH", cache: "no-store" });
    expect(JSON.parse(request.body as string)).toEqual({ kind: "wish", title: "یادگیری زبان", note: "سطر اول\nسطر دوم",
      target_date: "2027-01-01", status: "done", reminder_enabled: false, base_revision: 3 });
  });
  it("requests detail and deletion with no-store and the deletion's current revision", async () => {
    const context = setup(); await context.repo.get("goal");
    context.fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await context.repo.remove("goal", 3);
    expect(context.fetchMock.mock.calls.map(([url, init]) => ({ url: url.slice(url.indexOf("/goals")), method: init.method, cache: init.cache })))
      .toEqual([{ url: "/goals/goal", method: "GET", cache: "no-store" }, { url: "/goals/goal?base_revision=3", method: "DELETE", cache: "no-store" }]);
  });
  it("propagates a revoked permission instead of returning private data from an earlier response", async () => {
    const context = setup(); await context.repo.get("goal");
    context.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }));
    await expect(context.repo.get("goal")).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });
});
