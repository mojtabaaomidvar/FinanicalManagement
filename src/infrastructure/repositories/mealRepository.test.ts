import { afterEach, describe, expect, it, vi } from "vitest";
import type { MealIngredient } from "@/domain/meal/meal.types";
import type { ShoppingOfflineState } from "@/domain/shopping/offline.types";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestMealRepository } from "./mealRepository";

afterEach(() => vi.unstubAllGlobals());

const emptyState = (): ShoppingOfflineState => ({
  scope: { memberId: "member-a", familyId: "family-a", familyName: "تست", validatedAt: "2026-11-14T08:00:00Z" },
  snapshot: { lists: [], inventory: [] }, view: { lists: [], inventory: [] },
  pending: [], issues: [], lastSyncedAt: null, syncing: false, storageAvailable: true, offline: false,
});
const selected = (): MealIngredient[] => [{ title: "برنج", qty: 1.5, unit: "پیمانه" }];
const response = (replayed = false): Response => new Response(JSON.stringify({
  operation_id: "operation", list_id: "list", replayed,
  added: [{ id: "item", title: "برنج", qty: "1.50", unit: "پیمانه" }], skipped: [],
  added_count: 1, skipped_count: 0,
}), { status: 200, headers: { "Content-Type": "application/json" } });

function setup() {
  vi.stubGlobal("navigator", { onLine: true });
  let token: string | null = "token-a";
  const state = emptyState();
  const getToken = vi.fn(async () => token);
  const readState = vi.fn(async () => structuredClone(state));
  const refresh = vi.fn(async () => structuredClone(state));
  const fetchMock = vi.fn(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  const engine = { readState, refresh } as unknown as ShoppingOfflineEngine;
  const repo = new RestMealRepository(new RestClient({ getToken }), engine, { getToken });
  return { repo, state, getToken, readState, refresh, fetchMock, setToken: (value: string | null) => { token = value; } };
}

describe("online meal transport and shopping imports", () => {
  it("round-trips explicit unknown dish quantities without converting null into zero or changing old numeric rows", async () => {
    const context = setup();
    const input = { title: "عدس‌پلو", ingredients: [{ title: "عدس", qty: null, unit: null }, { title: "برنج", qty: 2, unit: "پیمانه" }] };
    const row = { ...input, id: "dish", created_by: "member-a", revision: 1, created_at: "now", updated_at: "now", can_edit: true, can_delete: true };
    context.fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...row, ingredients: [input.ingredients[0], { ...input.ingredients[1], qty: "2.00" }] }), { status: 201 }));
    expect((await context.repo.addDish(input)).ingredients).toEqual(input.ingredients);
    const request = context.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toEqual(input);
    context.fetchMock.mockImplementation(async () => new Response(JSON.stringify([row])));
    expect((await context.repo.listDishes())[0].ingredients).toEqual(input.ingredients);
  });
  it("uses the bearer captured when an ordinary meal request starts and maps decimal quantities", async () => {
    const context = setup();
    let resolveToken!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { resolveToken = resolve; }));
    context.fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify([{
      id: "dish", title: "برنج", ingredients: [{ title: "برنج", qty: "1.50", unit: null }],
      created_by: "member-a", revision: 3, created_at: "2026-11-14T08:00:00Z", updated_at: "2026-11-14T09:00:00Z",
      can_edit: true, can_delete: false,
    }]), { status: 200 }));
    const loading = context.repo.listDishes();
    context.setToken("token-b");
    resolveToken("token-a");
    expect(await loading).toEqual([expect.objectContaining({ ingredients: [{ title: "برنج", qty: 1.5, unit: null }], revision: 3, canEdit: true, canDelete: false })]);
    const request = context.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[1].headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect(request[1].cache).toBe("no-store");
  });

  it("rejects disconnected meals or a missing session before sending anything", async () => {
    const context = setup();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(context.repo.listDishes()).rejects.toMatchObject({ code: "NETWORK" });
    await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).rejects.toMatchObject({ code: "NETWORK" });
    vi.stubGlobal("navigator", { onLine: true });
    context.setToken(null);
    await expect(context.repo.listDishes()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("blocks importing when shopping synchronization leaves a pending conflict", async () => {
    const context = setup();
    context.state.pending.push({
      operation: { operation_id: "pending", kind: "list.update", entity_id: "list", base_revision: 1, payload: { title: "تست" } },
      createdAt: "2026-11-14T08:00:00Z", status: "conflict",
    });
    await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(context.state.pending).toHaveLength(1);
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a changed account or family while shopping is synchronizing", async () => {
    for (const change of ["token", "family", "member"] as const) {
      const context = setup();
      context.refresh.mockImplementationOnce(async () => {
        if (change === "token") context.setToken("token-b");
        else if (change === "family") context.state.scope!.familyId = "family-b";
        else context.state.scope!.memberId = "member-b";
        return structuredClone(context.state);
      });
      await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
      expect(context.fetchMock).not.toHaveBeenCalled();
    }
  });

  it("takes an immutable copy of the gesture before asynchronous shopping preparation", async () => {
    const context = setup();
    let release!: (state: ShoppingOfflineState) => void;
    context.refresh.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const items = selected();
    const importing = context.repo.addIngredientsToShopping("list", items, "operation");
    await vi.waitFor(() => expect(context.refresh).toHaveBeenCalledOnce());
    items[0].qty = 99;
    items.push({ title: "عدس", qty: 2, unit: null });
    release(structuredClone(context.state));
    await importing;
    const request = context.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request[1].body as string)).toEqual({ operation_id: "operation", items: selected() });
  });

  it("retains the caller's operation id when a committed response is lost and retried", async () => {
    const context = setup();
    context.fetchMock.mockRejectedValueOnce(new TypeError("connection lost"));
    context.fetchMock.mockImplementationOnce(async () => response(true));
    await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).rejects.toMatchObject({ code: "NETWORK" });
    expect(await context.repo.addIngredientsToShopping("list", selected(), "operation")).toMatchObject({ operationId: "operation", replayed: true, addedCount: 1 });
    const requests = context.fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(requests.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { operation_id: "operation", items: selected() }, { operation_id: "operation", items: selected() },
    ]);
  });

  it("reports a committed import as successful when its follow-up shopping refresh fails", async () => {
    const context = setup();
    context.refresh.mockResolvedValueOnce(structuredClone(context.state)).mockRejectedValueOnce(new Error("refresh failed"));
    await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).resolves.toMatchObject({ addedCount: 1, added: [{ id: "item", title: "برنج", qty: 1.5, unit: "پیمانه" }] });
  });

  it("reports a committed import as successful when the post-commit identity/cache read fails", async () => {
    const context = setup();
    context.fetchMock.mockImplementationOnce(async () => {
      context.readState.mockRejectedValueOnce(new Error("storage unavailable"));
      return response();
    });
    await expect(context.repo.addIngredientsToShopping("list", selected(), "operation")).resolves.toMatchObject({ operationId: "operation", addedCount: 1 });
    expect(context.refresh).toHaveBeenCalledOnce();
  });
});
