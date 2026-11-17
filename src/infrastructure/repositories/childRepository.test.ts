import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestChildRepository } from "./childRepository";
import type { ChildInput } from "@/domain/child/child.types";

afterEach(() => vi.unstubAllGlobals());
const child = { id: "member-child", name: "سارا", birth_date: "2026-11-15", age_years: 0, status: "pending", revision: 3, can_edit: true };
const input: ChildInput = { name: "  سارا  ", birthDate: null };
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
function setup() {
  vi.stubGlobal("navigator", { onLine: true }); let token: string | null = "token-a";
  const getToken = vi.fn(async () => token);
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(child));
  vi.stubGlobal("fetch", fetchMock); const provider = { getToken };
  return { repo: new RestChildRepository(new RestClient(provider), provider), getToken, fetchMock, setToken: (next: string | null) => { token = next; } };
}

describe("online child transport", () => {
  it("retains the canonical Member id and newborn age without copying unrelated metadata", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ children: [{ ...child, phone: "private", password_hash: "private", document_access_not_before: "private" }], can_create: true }));
    expect(await context.repo.list()).toEqual({ children: [{ id: child.id, name: child.name, birthDate: child.birth_date, ageYears: 0, status: "pending", revision: 3, canEdit: true }], canCreate: true });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer token-a" } });
  });
  it("maps only shared task, activity and birthday references in a focused detail", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({
      child, tasks: [{ id: "task", title: "تمرین", due_date: null, completed: false, completion_photo_url: "private", description: "private" }],
      activities: [{ id: "activity", title: "پارک", date: "2026-11-16", location: "محله", status: "planned", note: "not requested" }],
      birthday: { id: "event", title: "تولد سارا", date: "2026-11-15", member_id: "owner" }, goals: ["private"],
    }));
    expect(await context.repo.get(child.id)).toEqual({
      child: { id: child.id, name: child.name, birthDate: child.birth_date, ageYears: 0, status: "pending", revision: 3, canEdit: true },
      tasks: [{ id: "task", title: "تمرین", dueDate: null, completed: false }],
      activities: [{ id: "activity", title: "پارک", date: "2026-11-16", location: "محله", status: "planned" }],
      birthday: { id: "event", title: "تولد سارا", date: "2026-11-15" },
    });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it("does not grant write capabilities to unknown truthy values", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ children: [{ ...child, can_edit: "true" }], can_create: "true" }));
    expect(await context.repo.list()).toMatchObject({ children: [{ canEdit: false }], canCreate: false });
  });
  it("blocks all operations offline before reading a token or fetching data", async () => {
    const context = setup(); vi.stubGlobal("navigator", { onLine: false });
    for (const action of [() => context.repo.list(), () => context.repo.get(child.id), () => context.repo.add(input), () => context.repo.update(child.id, input, 3)])
      await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled(); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("never sends an unauthenticated child write after logout", async () => {
    const context = setup(); context.setToken(null);
    await expect(context.repo.add(input)).rejects.toMatchObject({ code: "SESSION_EXPIRED" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("binds pending profile writes to the token captured before another account signs in", async () => {
    const context = setup(); let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = context.repo.add(input); context.setToken("token-b"); release("token-a"); await pending;
    expect(context.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-a" }); expect(context.getToken).toHaveBeenCalledOnce();
  });
  it("stops a prepared write if the device disconnects while retrieving the session", async () => {
    const context = setup(); let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = context.repo.add(input); vi.stubGlobal("navigator", { onLine: false }); release("token-a");
    await expect(pending).rejects.toMatchObject({ code: "NETWORK" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("sends only approved child profile fields and a revision through the canonical child route", async () => {
    const context = setup(); await context.repo.update("member/child", { ...input, familyId: "other", phone: "private", role: "owner", relation: "خودم" } as ChildInput, 3);
    const [url, request] = context.fetchMock.mock.calls[0]; expect(url).toContain("/children/member%2Fchild");
    expect(request).toMatchObject({ method: "PATCH", cache: "no-store" });
    expect(JSON.parse(request.body as string)).toEqual({ name: "سارا", birth_date: null, base_revision: 3 });
  });
  it("creates an introduced child without submitting a mobile number", async () => {
    const context = setup(); await context.repo.add(input);
    expect(JSON.parse(context.fetchMock.mock.calls[0][1].body as string)).toEqual({ name: "سارا", birth_date: null });
  });
  it("propagates access revocation instead of returning an earlier snapshot", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ children: [child], can_create: true })); await context.repo.list();
    context.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }));
    await expect(context.repo.list()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 }); expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });
});
