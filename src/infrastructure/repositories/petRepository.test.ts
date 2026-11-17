import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestPetRepository } from "./petRepository";
import type { PetCareInput, PetInput } from "@/domain/pet/pet.types";

afterEach(() => vi.unstubAllGlobals());
const pet = { id: "pet", name: "پیشی", species: "گربه", breed: null, birth_date: null, revision: 3,
  created_at: "2026-11-15T08:00:00Z", updated_at: "2026-11-15T09:00:00Z", can_edit: true, can_delete: true };
const care = { id: "canonical-task", title: "غذا دادن", assignee_id: "member", due_date: "2026-11-15", completed: false, revision: 1, can_complete: true };
const input: PetInput = { name: "  پیشی  ", species: "  گربه  ", breed: "  ", birthDate: null };
const careInput: PetCareInput = { title: "  غذا دادن  ", assigneeId: "member", dueDate: "2026-11-15" };
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
function setup() {
  vi.stubGlobal("navigator", { onLine: true }); let token: string | null = "token-a";
  const getToken = vi.fn(async () => token); const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(pet));
  vi.stubGlobal("fetch", fetchMock); const provider = { getToken };
  return { repo: new RestPetRepository(new RestClient(provider), provider), getToken, fetchMock, setToken: (value: string | null) => { token = value; } };
}
describe("online pet transport", () => {
  it("maps the approved profile and server capabilities with no-store", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ pets: [{ ...pet, family_id: "family", finance: "private", medical: "private" }], can_create: true }));
    expect(await context.repo.list()).toEqual({ pets: [{ id: pet.id, name: pet.name, species: pet.species, breed: null, birthDate: null,
      revision: 3, createdAt: pet.created_at, updatedAt: pet.updated_at, canEdit: true, canDelete: true }], canCreate: true });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer token-a" } });
  });
  it("reads care summaries with canonical Task ids and no private or cached pet metadata", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ pet,
      care_tasks: [{ ...care, description: "unrequested", completion_photo_url: "private", pet_id: "server-only" }], can_create_care: true }));
    expect(await context.repo.get(pet.id)).toEqual({
      pet: { id: pet.id, name: pet.name, species: pet.species, breed: null, birthDate: null, revision: 3,
        createdAt: pet.created_at, updatedAt: pet.updated_at, canEdit: true, canDelete: true },
      careTasks: [{ id: "canonical-task", title: care.title, assigneeId: "member", dueDate: care.due_date,
        completed: false, revision: 1, canComplete: true }], canCreateCare: true,
    });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });
  it("requires true server flags to enable profile deletion or task completion", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ pet: { ...pet, can_edit: "true", can_delete: "true" },
      care_tasks: [{ ...care, can_complete: "true" }], can_create_care: "true" }));
    expect(await context.repo.get(pet.id)).toMatchObject({ pet: { canEdit: false, canDelete: false }, careTasks: [{ canComplete: false }], canCreateCare: false });
  });
  it("blocks every pet operation offline before reading the token or fetching", async () => {
    const context = setup(); vi.stubGlobal("navigator", { onLine: false });
    for (const action of [() => context.repo.list(), () => context.repo.get(pet.id), () => context.repo.add(input), () => context.repo.update(pet.id, input, 3),
      () => context.repo.remove(pet.id, 3), () => context.repo.addCare(pet.id, careInput, 3, "operation")]) await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled(); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("never sends profile or care data after logout", async () => {
    const context = setup(); context.setToken(null); await expect(context.repo.add(input)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(context.repo.addCare(pet.id, careInput, 3, "operation")).rejects.toMatchObject({ code: "SESSION_EXPIRED" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("binds the request to the token captured before another account signs in", async () => {
    const context = setup(); let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = context.repo.add(input); context.setToken("token-b"); release("token-a"); await pending;
    expect(context.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-a" }); expect(context.getToken).toHaveBeenCalledOnce();
  });
  it("does not send a prepared care task after a disconnect while reading the token", async () => {
    const context = setup(); let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const pending = context.repo.addCare(pet.id, careInput, 3, "operation"); vi.stubGlobal("navigator", { onLine: false }); release("token-a");
    await expect(pending).rejects.toMatchObject({ code: "NETWORK" }); expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("sends only profile fields and the viewed revision through the pet route", async () => {
    const context = setup(); await context.repo.update("pet/shared", { ...input, familyId: "other", cost: 100, medical: "private" } as PetInput, 3);
    const [url, request] = context.fetchMock.mock.calls[0]; expect(url).toContain("/pets/pet%2Fshared"); expect(request).toMatchObject({ method: "PATCH", cache: "no-store" });
    expect(JSON.parse(request.body as string)).toEqual({ name: "پیشی", species: "گربه", breed: null, birth_date: null, base_revision: 3 });
  });
  it("uses the stable operation identity for care creation and accepts no caller-owned pet/family metadata", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response(care));
    expect(await context.repo.addCare("pet/shared", { ...careInput, petId: "other", familyId: "other", cost: 100 } as PetCareInput, 3, "operation")).toEqual({
      id: "canonical-task", title: care.title, assigneeId: "member", dueDate: care.due_date, completed: false, revision: 1, canComplete: true,
    });
    const [url, request] = context.fetchMock.mock.calls[0]; expect(url).toContain("/pets/pet%2Fshared/care-tasks");
    expect(JSON.parse(request.body as string)).toEqual({ title: "غذا دادن", assignee_id: "member", due_date: "2026-11-15", base_revision: 3, operation_id: "operation" });
  });
  it("deletes only through the revision-controlled pet route", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 })); await context.repo.remove(pet.id, 3);
    const [url, request] = context.fetchMock.mock.calls[0]; expect(url).toContain("/pets/pet?base_revision=3"); expect(request).toMatchObject({ method: "DELETE", cache: "no-store" });
  });
  it("does not return a cached profile after access is revoked", async () => {
    const context = setup(); context.fetchMock.mockImplementationOnce(async () => response({ pets: [pet], can_create: true })); await context.repo.list();
    context.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }));
    await expect(context.repo.list()).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 }); expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });
});
