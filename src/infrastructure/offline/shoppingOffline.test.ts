import { afterEach, describe, expect, it } from "vitest";
import type { StoredSession } from "../../domain/auth/auth.types";
import type {
  OfflineMutation, OfflineMutationResult, OfflineScope, OfflineSnapshot,
  ShoppingOfflineTransport,
} from "../../domain/shopping/offline.types";
import type { SecureStorage } from "../storage/secureStorage.adapter";
import { ShoppingOfflineEngine, clearShoppingOffline } from "./shoppingOffline";
import { projectSnapshot, sanitizeSnapshot } from "./projection";
import { OfflineTaskRepository } from "../repositories/taskRepository";

const familyId = "10000000-0000-4000-8000-000000000001";
const memberId = "10000000-0000-4000-8000-000000000002";
const inventoryId = "10000000-0000-4000-8000-000000000003";
const listId = "10000000-0000-4000-8000-000000000004";
const itemId = "10000000-0000-4000-8000-000000000005";
const taskId = "10000000-0000-4000-8000-000000000006";
const otherMemberId = "10000000-0000-4000-8000-000000000007";
const completionPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const savedPhotoUrl = `/api/v1/files/tasks/${taskId}/completion.png?sig=test-signature`;
const scope = (): OfflineScope => ({
  familyId, memberId, familyName: "خانوادهٔ تست", validatedAt: new Date().toISOString(),
});
const session = (family = familyId, member = memberId, token = "test-session"): StoredSession => ({
  token, member: { id: member }, family: { id: family },
} as StoredSession);

class PersistentMemory implements SecureStorage {
  readonly values = new Map<string, unknown>();
  constructor(readonly persistent = true) {}
  async get<T>(key: string): Promise<T | null> {
    return this.values.has(key) ? structuredClone(this.values.get(key)) as T : null;
  }
  async set<T>(key: string, value: T): Promise<void> { this.values.set(key, structuredClone(value)); }
  async remove(key: string): Promise<void> { this.values.delete(key); }
}

const initialSnapshot = (): OfflineSnapshot => ({
  inventory: [{
    id: inventoryId, title: "شیر", unit: "عدد", quantity: 2, threshold: 1,
    note: null, revision: 1, created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z",
  }],
  lists: [{
    id: listId, title: "سوپرمارکت", revision: 1, created_at: "2026-11-12T10:00:00Z",
    items: [{
      id: itemId, list_id: listId, title: "شیر", qty: 1, unit: "عدد", checked: false,
      inventory_item_id: inventoryId, note: null, revision: 1, created_at: "2026-11-12T10:00:00Z",
    }],
  }],
});

class Server implements ShoppingOfflineTransport {
  data = initialSnapshot();
  online = true;
  applied = 0;
  loseNextReply = false;
  authRejected = false;
  taskForbidden = false;
  readonly receipts = new Map<string, OfflineMutationResult>();
  private requireConnection(): void {
    if (!this.online) throw { code: "NETWORK", message: "قطع" };
    if (this.authRejected) throw { code: "SESSION_EXPIRED", status: 401 };
  }
  async snapshot(): Promise<OfflineSnapshot> {
    this.requireConnection();
    return structuredClone(this.data);
  }
  async mutate(operation: OfflineMutation): Promise<OfflineMutationResult> {
    this.requireConnection();
    if (this.taskForbidden && operation.kind.startsWith("task.")) {
      throw { code: "FORBIDDEN", serverCode: "TASK_FORBIDDEN", status: 403, message: "مجوز تغییر این کار را ندارید." };
    }
    const existing = this.receipts.get(operation.operation_id);
    if (existing) return { ...existing, replayed: true, snapshot: structuredClone(this.data) };
    let revision: number | null;
    if (operation.kind === "inventory.adjust") {
      const item = this.data.inventory.find((row) => row.id === operation.entity_id)!;
      if (item.revision !== operation.base_revision) throw { code: "CONFLICT", status: 409, message: "عضو دیگر موجودی را تغییر داده است." };
      item.quantity += operation.payload.delta;
      item.revision += 1;
      revision = item.revision;
    } else if (operation.kind === "item.check") {
      const list = this.data.lists.find((row) => row.items.some((item) => item.id === operation.entity_id))!;
      const item = list.items.find((row) => row.id === operation.entity_id)!;
      if (item.revision !== operation.base_revision) throw { code: "CONFLICT", status: 409 };
      item.checked = operation.payload.checked;
      item.revision += 1;
      list.revision += 1;
      revision = item.revision;
    } else if (operation.kind === "task.create") {
      this.data.tasks ??= [];
      this.data.tasks.push({
        id: operation.entity_id, title: operation.payload.title,
        description: operation.payload.description ?? null,
        assignee_id: operation.payload.assignee_id ?? null,
        due_date: operation.payload.due_date ?? null,
        completed: false, completed_by: null, completed_at: null,
        created_by: memberId, revision: 1,
        created_at: "2026-11-14T10:00:00Z", updated_at: "2026-11-14T10:00:00Z",
      });
      revision = 1;
    } else if (operation.kind === "task.update" || operation.kind === "task.complete" || operation.kind === "task.delete") {
      const task = this.data.tasks?.find((row) => row.id === operation.entity_id);
      if (!task) throw { code: "NOT_FOUND", status: 404 };
      if (task.revision !== operation.base_revision) throw { code: "CONFLICT", status: 409, message: "کار توسط عضو دیگر تغییر کرده است." };
      if (operation.kind === "task.update") {
        task.title = operation.payload.title;
        task.description = operation.payload.description ?? null;
        task.assignee_id = operation.payload.assignee_id ?? null;
        task.due_date = operation.payload.due_date ?? null;
        task.revision += 1;
        revision = task.revision;
      } else if (operation.kind === "task.complete") {
        if (task.completed !== operation.payload.completed) {
          task.completed = operation.payload.completed;
          task.completed_by = operation.payload.completed ? memberId : null;
          task.completed_at = operation.payload.completed ? "2026-11-14T10:01:00Z" : null;
          task.completion_photo_url = null;
        }
        if (!operation.payload.completed) task.completion_photo_url = null;
        else if (operation.payload.completion_photo != null) task.completion_photo_url = savedPhotoUrl;
        task.revision += 1;
        revision = task.revision;
      } else {
        this.data.tasks = this.data.tasks!.filter((row) => row.id !== operation.entity_id);
        revision = null;
      }
    } else throw new Error("Test server does not support this operation.");
    const result: OfflineMutationResult = {
      operation_id: operation.operation_id, replayed: false,
      entity_type: operation.kind.startsWith("inventory") ? "inventory" : operation.kind.startsWith("task.") ? "task" : "item",
      entity_id: operation.entity_id, revision, snapshot: structuredClone(this.data),
    };
    this.receipts.set(operation.operation_id, result);
    this.applied += 1;
    if (this.loseNextReply) {
      this.loseNextReply = false;
      this.online = false;
      throw { code: "NETWORK" };
    }
    return result;
  }
}

const engines: ShoppingOfflineEngine[] = [];
afterEach(() => { for (const engine of engines.splice(0)) engine.dispose(); });

async function setup(storage = new PersistentMemory(), server = new Server()) {
  await storage.set("session", session());
  const engine = new ShoppingOfflineEngine(storage, server);
  engines.push(engine);
  await engine.initialize(scope());
  await engine.refresh();
  return { engine, storage, server };
}

describe("encrypted outbox orchestration", () => {
  it("keeps sequential edits across reload and syncs each exactly once", async () => {
    const { engine, storage, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    const queued = await engine.readState();
    expect(queued.view.inventory[0].quantity).toBe(4);
    expect(queued.pending.map((entry) => entry.operation.base_revision)).toEqual([1, 2]);
    const reloaded = new ShoppingOfflineEngine(storage, server);
    engines.push(reloaded);
    expect(await reloaded.loadScope()).toEqual(expect.objectContaining({ familyId, memberId }));
    expect((await reloaded.readState()).pending).toHaveLength(2);
    server.online = true;
    const synced = await reloaded.sync();
    expect(synced.pending).toHaveLength(0);
    expect(synced.view.inventory[0].quantity).toBe(4);
    expect(server.applied).toBe(2);
    await reloaded.sync();
    expect(server.applied).toBe(2);
  });

  it("retries a committed write whose response was lost without applying twice", async () => {
    const { engine, server } = await setup();
    server.loseNextReply = true;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    expect((await engine.readState()).pending).toHaveLength(1);
    expect(server.data.inventory[0].quantity).toBe(3);
    server.online = true;
    expect((await engine.sync()).pending).toHaveLength(0);
    expect(server.data.inventory[0].quantity).toBe(3);
    expect(server.applied).toBe(1);
  });

  it("retains a conflict, displays server truth and never overwrites another member", async () => {
    const { engine, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    server.data.inventory[0].quantity = 10;
    server.data.inventory[0].revision = 2;
    server.online = true;
    const conflicted = await engine.sync();
    expect(conflicted.issues).toHaveLength(1);
    expect(conflicted.issues[0].kind).toBe("conflict");
    expect(conflicted.view.inventory[0].quantity).toBe(10);
    expect(server.applied).toBe(0);
    await expect(engine.mutate("inventory.adjust", inventoryId, { delta: 1 })).rejects.toThrow("بررسی");
    await engine.discard(conflicted.issues[0].operationId!);
    expect((await engine.sync()).pending).toHaveLength(0);
    expect(server.data.inventory[0].quantity).toBe(10);
  });

  it("does not enqueue financial payloads or unsupported memory fallback", async () => {
    const { engine } = await setup();
    await expect(engine.mutate("item.check", itemId, { checked: true, price: 10000 } as { checked: boolean })).rejects.toThrow("مالی");
    expect((await engine.readState()).pending).toHaveLength(0);
    const fallback = await setup(new PersistentMemory(false));
    await expect(fallback.engine.mutate("inventory.adjust", inventoryId, { delta: 1 })).rejects.toThrow("ذخیره‌سازی");
  });

  it("never mistakes a discarded own prediction for another member's same revision", async () => {
    const { engine, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    server.data.inventory[0].quantity = 10;
    server.data.inventory[0].revision = 2;
    server.online = true;
    const conflicted = await engine.sync();
    await engine.discard(conflicted.pending[0].operation.operation_id);
    const dependent = await engine.sync();
    expect(dependent.pending).toHaveLength(1);
    expect(dependent.issues[0].kind).toBe("failed");
    expect(dependent.view.inventory[0].quantity).toBe(10);
    expect(server.applied).toBe(0);
  });

  it("removes unsafe response fields before anything reaches the offline store", async () => {
    const { engine, server, storage } = await setup();
    Object.assign(server.data.lists[0].items[0], { price: 12000, transaction_id: "sensitive", created_by: memberId });
    Object.assign(server.data.inventory[0], { account_number: "sensitive", created_by: memberId });
    await engine.refresh();
    const offlineRecords = [...storage.values.entries()].filter(([key]) => key.startsWith("shopping-offline:"));
    const serialized = JSON.stringify(offlineRecords);
    for (const forbidden of ["price", "transaction_id", "created_by", "account_number"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("clears cached data after a confirmed expired session and keeps rejected writes visible", async () => {
    const { engine, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    server.online = true;
    server.authRejected = true;
    const rejected = await engine.sync();
    expect(rejected.issues[0].kind).toBe("auth");
    expect(rejected.pending).toHaveLength(1);
    expect(rejected.view.inventory).toHaveLength(0);
    expect(await engine.loadScope()).toBeNull();
  });

  it("does not replay old-family operations after an account switch", async () => {
    const { engine, storage, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    await storage.set("session", session("other-family", "other-member", "other-token"));
    expect(await engine.loadScope()).toBeNull();
    server.online = true;
    await engine.sync();
    expect(server.applied).toBe(0);
    await engine.initialize({ ...scope(), familyId: "other-family", memberId: "other-member" });
    expect((await engine.readState()).pending).toHaveLength(0);
    const oldPartition = await storage.get<{ pending: unknown[] }>(`shopping-offline:${familyId}:${memberId}`);
    expect(oldPartition?.pending).toHaveLength(1);
    await engine.clear();
    expect([...storage.values.keys()].some((key) => key.startsWith("shopping-offline"))).toBe(false);
  });

  it("preserves and safely rebinds same-actor work after a renewed online login", async () => {
    const { engine, storage, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    await storage.set("session", session(familyId, memberId, "renewed-token"));
    expect(await engine.loadScope()).toBeNull();
    await engine.initialize(scope());
    expect((await engine.readState()).pending).toHaveLength(1);
    server.online = true;
    const synced = await engine.sync();
    expect(synced.pending).toHaveLength(0);
    expect(synced.view.inventory[0].quantity).toBe(3);
    expect(server.applied).toBe(1);
  });

  it("restores auth-failed writes after reauth while keeping their original conflict guard", async () => {
    const { engine, storage, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    server.online = true;
    server.authRejected = true;
    expect((await engine.sync()).issues[0].kind).toBe("auth");
    server.data.inventory[0].revision = 2;
    server.data.inventory[0].quantity = 10;
    server.authRejected = false;
    await storage.set("session", session(familyId, memberId, "renewed-token"));
    await engine.initialize(scope());
    expect((await engine.readState()).pending[0].operation.base_revision).toBe(1);
    const guarded = await engine.sync();
    expect(guarded.issues[0].kind).toBe("conflict");
    expect(guarded.view.inventory[0].quantity).toBe(10);
    expect(server.applied).toBe(0);
  });

  it("returns the committed optimistic view without awaiting an unresolved network request", async () => {
    const { engine, server } = await setup();
    const original = server.mutate.bind(server);
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    server.mutate = (operation) => new Promise((resolve, reject) => {
      markStarted?.();
      release = () => { void original(operation).then(resolve, reject); };
    });
    const result = await Promise.race([
      engine.mutate("inventory.adjust", inventoryId, { delta: 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Optimistic save waited for network")), 200)),
    ]);
    expect(result.view.inventory[0].quantity).toBe(3);
    expect(result.pending).toHaveLength(1);
    await started;
    release?.();
    await engine.sync();
    expect(server.applied).toBe(1);
  });

  it("keeps a second enqueue responsive while another request holds the delivery lock", async () => {
    const { engine, server } = await setup();
    const original = server.mutate.bind(server);
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    let first = true;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    server.mutate = (operation) => {
      if (!first) return original(operation);
      first = false;
      return new Promise((resolve, reject) => {
        markStarted?.();
        release = () => { void original(operation).then(resolve, reject); };
      });
    };
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await started;
    const result = await Promise.race([
      engine.mutate("inventory.adjust", inventoryId, { delta: 1 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Second save waited for the first fetch")), 200)),
    ]);
    expect(result.view.inventory[0].quantity).toBe(4);
    expect(result.pending.map((entry) => entry.operation.base_revision)).toEqual([1, 2]);
    release?.();
    await engine.sync();
    expect(server.applied).toBe(2);
    expect((await engine.readState()).pending).toHaveLength(0);
  });

  it("cannot recreate offline state when logout happens during a response", async () => {
    const { engine, storage, server } = await setup();
    let finish: ((snapshot: OfflineSnapshot) => void) | undefined;
    let started: (() => void) | undefined;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    server.snapshot = () => { started?.(); return new Promise((resolve) => { finish = resolve; }); };
    const running = engine.refresh();
    await ready;
    await storage.remove("session");
    const clearing = clearShoppingOffline(storage);
    finish?.(initialSnapshot());
    await running;
    await clearing;
    expect((await engine.readState()).view.inventory).toHaveLength(0);
    expect([...storage.values.keys()].some((key) => key.startsWith("shopping-offline"))).toBe(false);
  });
});

describe("safe optimistic projection", () => {
  it("increments child and parent revisions and leaves the source snapshot intact", () => {
    const base = initialSnapshot();
    const operation: OfflineMutation = {
      operation_id: "check", entity_id: itemId, kind: "item.check", base_revision: 1, payload: { checked: true },
    };
    const projected = projectSnapshot(base, [{ operation, createdAt: new Date().toISOString(), status: "pending" }]);
    expect(projected.lists[0].revision).toBe(2);
    expect(projected.lists[0].items[0].revision).toBe(2);
    expect(projected.lists[0].items[0].checked).toBe(true);
    expect(base.lists[0].revision).toBe(1);
    expect(base.lists[0].items[0].checked).toBe(false);
  });

  it("stops dependent projection at a failed change and strips runtime extras", () => {
    const base = initialSnapshot();
    Object.assign(base.lists[0].items[0], { price: 1, bought_by_member_id: memberId });
    const operation: OfflineMutation = {
      operation_id: "adjust", entity_id: inventoryId, kind: "inventory.adjust", base_revision: 1, payload: { delta: 1 },
    };
    const projected = projectSnapshot(base, [
      { operation, createdAt: new Date().toISOString(), status: "conflict" },
      { operation: { ...operation, operation_id: "later", base_revision: 2 }, createdAt: new Date().toISOString(), status: "pending" },
    ]);
    expect(projected.inventory[0].quantity).toBe(2);
    expect(JSON.stringify(sanitizeSnapshot(base))).not.toContain("price");
    expect(JSON.stringify(projected)).not.toContain("bought_by_member_id");
  });
});

describe("tasks in the existing household outbox", () => {
  it("preserves only task reminder preferences and clamps their lead time in the offline snapshot", async () => {
    const { engine, server, storage } = await setup();
    server.data.task_notification_prefs = {
      enabled: false, tasks_enabled: false, lead_days: 999,
    };
    Object.assign(server.data.task_notification_prefs, {
      member_phone: "private-phone", bills_enabled: false, financial_settings: "private-finance",
    });
    await engine.refresh();
    const state = await engine.readState();
    expect(state.view.task_notification_prefs).toEqual({ enabled: false, tasks_enabled: false, lead_days: 60 });
    const serialized = JSON.stringify([...storage.values.entries()].filter(([key]) => key.startsWith("shopping-offline:")));
    expect(serialized).not.toContain("private-phone");
    expect(serialized).not.toContain("private-finance");
    expect(serialized).not.toContain("bills_enabled");
    expect(sanitizeSnapshot({ ...server.data, task_notification_prefs: undefined }).task_notification_prefs)
      .toEqual({ enabled: true, tasks_enabled: true, lead_days: 0 });
    server.data.task_notification_prefs.lead_days = -5;
    expect(sanitizeSnapshot(server.data).task_notification_prefs?.lead_days).toBe(0);
  });

  it("rejects a stale displayed task after a background refresh instead of borrowing the newer revision", async () => {
    const { engine, server } = await setup();
    const repository = new OfflineTaskRepository(engine);
    const opened = await repository.add({ title: "متن هنگام بازکردن فرم" });
    await engine.sync();
    server.data.tasks![0].title = "ویرایش عضو دیگر";
    server.data.tasks![0].revision = 2;
    await engine.refresh();
    await expect(repository.update(opened.id, { title: "متن فرم قدیمی" }, opened.revision)).rejects.toThrow("تغییر کرده");
    await expect(repository.setCompleted(opened.id, true, opened.revision)).rejects.toThrow("تغییر کرده");
    await expect(repository.remove(opened.id, opened.revision)).rejects.toThrow("تغییر کرده");
    expect((await engine.readState()).pending).toHaveLength(0);
    expect(server.data.tasks![0]).toMatchObject({ title: "ویرایش عضو دیگر", revision: 2 });
    expect(server.applied).toBe(1);
  });

  it("accepts displayed optimistic revisions for consecutive task edits queued offline", async () => {
    const { engine, server } = await setup();
    const repository = new OfflineTaskRepository(engine);
    server.online = false;
    await engine.sync();
    const created = await repository.add({ title: "کار تازه" });
    const edited = await repository.update(created.id, { title: "کار به‌روز" }, created.revision);
    const completed = await repository.setCompleted(edited.id, true, edited.revision);
    await repository.remove(completed.id, completed.revision);
    const state = await engine.readState();
    expect(state.pending.map((entry) => entry.operation.base_revision)).toEqual([null, 1, 2, 3]);
    expect(state.view.tasks).toEqual([]);
    server.online = true;
    const synced = await engine.sync();
    expect(synced.pending).toHaveLength(0);
    expect(synced.view.tasks).toEqual([]);
    expect(server.applied).toBe(4);
  });

  it("keeps the original completion attribution on an already-completed no-op", async () => {
    const { engine, server } = await setup();
    await engine.mutate("task.create", taskId, { title: "کار" });
    await engine.sync();
    Object.assign(server.data.tasks![0], {
      completed: true, completed_by: otherMemberId,
      completed_at: "2026-11-14T09:00:00Z", revision: 2,
      completion_photo_url: savedPhotoUrl,
    });
    await engine.refresh();
    server.online = false;
    await engine.sync();
    const state = await engine.mutate("task.complete", taskId, { completed: true }, 2);
    expect(state.view.tasks?.[0]).toMatchObject({
      completed: true, completed_by: otherMemberId,
      completed_at: "2026-11-14T09:00:00Z", revision: 3,
      completion_photo_url: savedPhotoUrl,
    });
    const again = await engine.mutate("task.complete", taskId, { completed: true, completion_photo: null }, 3);
    expect(again.view.tasks?.[0].completion_photo_url).toBe(savedPhotoUrl);
    server.online = true;
    const synced = await engine.sync();
    expect(synced.view.tasks?.[0]).toMatchObject({
      completed_by: otherMemberId, completed_at: "2026-11-14T09:00:00Z",
      completion_photo_url: savedPhotoUrl, revision: 4,
    });
  });

  it("persists an optional completion photo across reload, replaces it with the server URL and safely retries a lost reply", async () => {
    const { engine, server, storage } = await setup();
    const repository = new OfflineTaskRepository(engine);
    const task = await repository.add({ title: "تعویض فیلتر" });
    await engine.sync();
    server.online = false;
    await engine.sync();
    const completed = await repository.setCompleted(task.id, true, task.revision, completionPhoto);
    expect(completed).toMatchObject({ completed: true, completionPhotoUrl: completionPhoto });
    const reloaded = new ShoppingOfflineEngine(storage, server);
    engines.push(reloaded);
    const reloadedRepository = new OfflineTaskRepository(reloaded);
    expect((await reloadedRepository.list())[0].completionPhotoUrl).toBe(completionPhoto);
    const queued = await reloaded.readState();
    expect(queued.pending[0].operation.payload).toEqual({ completed: true, completion_photo: completionPhoto });
    server.online = true;
    server.loseNextReply = true;
    await reloaded.sync();
    expect((await reloaded.readState()).pending).toHaveLength(1);
    expect(server.applied).toBe(2);
    server.online = true;
    await reloaded.sync();
    expect((await reloaded.readState()).pending).toHaveLength(0);
    expect((await reloadedRepository.list())[0].completionPhotoUrl).toBe(savedPhotoUrl);
    expect(server.applied).toBe(2);
    const afterAck = new ShoppingOfflineEngine(storage, server);
    engines.push(afterAck);
    expect((await new OfflineTaskRepository(afterAck).list())[0].completionPhotoUrl).toBe(savedPhotoUrl);
  });

  it("rejects invalid and oversized completion photos before storing a change", async () => {
    const { engine, server } = await setup();
    await engine.mutate("task.create", taskId, { title: "کار" });
    await engine.sync();
    server.online = false;
    await engine.sync();
    for (const photo of ["", "https://example.com/photo.jpg", "data:image/svg+xml;base64,AA==",
      "data:image/png;base64,", "data:image/png;base64,AA=", "data:image/jpeg;base64,A===",
      "data:image/png;base64,AA$=", "data:image/webp;base64,AA==\n"]) {
      await expect(engine.mutate("task.complete", taskId, { completed: true, completion_photo: photo }))
        .rejects.toThrow("معتبر");
    }
    await expect(engine.mutate("task.complete", taskId, { completed: true,
      completion_photo: `data:image/jpeg;base64,${"A".repeat(1_400_004)}` }))
      .rejects.toThrow("حجم");
    await expect(engine.mutate("task.complete", taskId, { completed: false, completion_photo: completionPhoto }))
      .rejects.toThrow("تأیید انجام");
    const state = await engine.readState();
    expect(state.pending).toHaveLength(0);
    expect(state.view.tasks?.[0]).toMatchObject({ completed: false, revision: 1 });
    expect(server.applied).toBe(1);
  });

  it("preserves an older shopping queue and projects task actor references across reload", async () => {
    const { engine, storage, server } = await setup();
    server.online = false;
    await engine.mutate("inventory.adjust", inventoryId, { delta: 1 });
    await engine.sync();
    const original = (await engine.readState()).pending[0].operation;

    const reloaded = new ShoppingOfflineEngine(storage, server);
    engines.push(reloaded);
    await reloaded.initialize(scope());
    expect((await reloaded.readState()).view.tasks).toEqual([]);
    await reloaded.mutate("task.create", taskId, {
      title: "تعویض فیلتر آب", assignee_id: memberId, due_date: "2026-11-20",
    });
    await reloaded.mutate("task.complete", taskId, { completed: true });
    const queued = await reloaded.readState();
    expect(queued.pending[0].operation).toEqual(original);
    expect(queued.pending.slice(1).map((entry) => entry.operation.base_revision)).toEqual([null, 1]);
    expect(queued.view.tasks?.[0]).toMatchObject({
      created_by: memberId, completed_by: memberId, completed: true, revision: 2,
    });
    expect(queued.view.inventory[0].quantity).toBe(3);
    const again = new ShoppingOfflineEngine(storage, server);
    engines.push(again);
    expect((await again.readState()).view.tasks?.[0].completed_by).toBe(memberId);
    server.online = true;
    const synced = await again.sync();
    expect(synced.pending).toHaveLength(0);
    expect(synced.view.inventory[0].quantity).toBe(3);
    expect(synced.view.tasks?.[0]).toMatchObject({ completed: true, created_by: memberId, revision: 2 });
    expect(server.applied).toBe(3);
  });

  it("retries a task creation whose reply was lost without creating it twice", async () => {
    const { engine, server } = await setup();
    server.loseNextReply = true;
    await engine.mutate("task.create", taskId, { title: "نظافت" });
    await engine.sync();
    expect((await engine.readState()).pending).toHaveLength(1);
    expect(server.data.tasks).toHaveLength(1);
    server.online = true;
    const synced = await engine.sync();
    expect(synced.pending).toHaveLength(0);
    expect(synced.view.tasks).toHaveLength(1);
    expect(server.applied).toBe(1);
  });

  it("retains an action permission failure without clearing the family session or shopping cache", async () => {
    const { engine, server } = await setup();
    await engine.mutate("task.create", taskId, { title: "نظافت" });
    await engine.sync();
    server.online = false;
    await engine.mutate("task.complete", taskId, { completed: true });
    await engine.sync();
    server.online = true;
    server.taskForbidden = true;
    const rejected = await engine.sync();
    expect(rejected.issues[0]).toMatchObject({ kind: "failed", status: "failed" });
    expect(rejected.pending).toHaveLength(1);
    expect(rejected.view.tasks?.[0].completed).toBe(false);
    expect(rejected.view.inventory).toHaveLength(1);
    expect(await engine.loadScope()).toMatchObject({ familyId, memberId });
    expect(server.applied).toBe(1);
  });

  it("shows the server task on a stale revision and never overwrites another member's edit", async () => {
    const { engine, server } = await setup();
    await engine.mutate("task.create", taskId, { title: "نظافت" });
    await engine.sync();
    server.online = false;
    await engine.mutate("task.update", taskId, { title: "نظافت آشپزخانه" });
    await engine.sync();
    server.data.tasks![0].title = "تغییر عضو دیگر";
    server.data.tasks![0].revision = 2;
    server.online = true;
    const conflicted = await engine.sync();
    expect(conflicted.issues[0].kind).toBe("conflict");
    expect(conflicted.view.tasks?.[0].title).toBe("تغییر عضو دیگر");
    expect(server.applied).toBe(1);
  });

  it("clears completion actor and timestamp when a task is reopened offline", async () => {
    const { engine, server } = await setup();
    server.online = false;
    await engine.sync();
    await engine.mutate("task.create", taskId, { title: "نظافت" });
    await engine.mutate("task.complete", taskId, { completed: true, completion_photo: completionPhoto });
    await engine.mutate("task.complete", taskId, { completed: false });
    const reopened = await engine.readState();
    expect(reopened.view.tasks?.[0]).toMatchObject({
      completed: false, completed_at: null, completed_by: null, completion_photo_url: null, revision: 3,
    });
    server.online = true;
    const synced = await engine.sync();
    expect(synced.view.tasks?.[0]).toMatchObject({
      completed: false, completed_at: null, completed_by: null, completion_photo_url: null,
    });
  });

  it("allows keeping an existing assignee offline but requires connection to choose another member", async () => {
    const { engine, server } = await setup();
    await engine.mutate("task.create", taskId, { title: "نظافت", assignee_id: otherMemberId });
    await engine.sync();
    server.online = false;
    await engine.sync();
    await engine.mutate("task.update", taskId, { title: "نظافت خانه", assignee_id: otherMemberId });
    await expect(engine.mutate("task.create", crypto.randomUUID(), { title: "کار تازه", assignee_id: otherMemberId }))
      .rejects.toThrow("اینترنت");
    await engine.mutate("task.update", taskId, { title: "نظافت خانه", assignee_id: memberId });
    expect((await engine.readState()).view.tasks?.[0].assignee_id).toBe(memberId);
  });

  it("rejects malformed task fields before persisting and strips full member profiles from snapshots", async () => {
    const { engine, server, storage } = await setup();
    await expect(engine.mutate("task.create", taskId, { title: "کار", due_date: "2026-02-30" })).rejects.toThrow("موعد");
    await expect(engine.mutate("task.create", taskId, { title: "کار", assignee_id: "not-a-uuid" })).rejects.toThrow("مسئول");
    await expect(engine.mutate("task.create", taskId, { title: "کار", created_by: otherMemberId } as { title: string })).rejects.toThrow("ناشناخته");
    expect((await engine.readState()).pending).toHaveLength(0);
    await engine.mutate("task.create", taskId, { title: "کار" });
    await engine.sync();
    await expect(new OfflineTaskRepository(engine).list()).resolves.toEqual([
      expect.objectContaining({ completionPhotoUrl: null }),
    ]);
    Object.assign(server.data.tasks![0], { assignee: { phone: "private-phone", role: "owner" }, finance: "private-finance" });
    server.data.tasks![0].completion_photo_url = savedPhotoUrl;
    await engine.refresh();
    const serialized = JSON.stringify([...storage.values.entries()].filter(([key]) => key.startsWith("shopping-offline:")));
    expect(serialized).not.toContain("private-phone");
    expect(serialized).not.toContain("private-finance");
    expect((await engine.readState()).view.tasks?.[0].created_by).toBe(memberId);
    expect((await new OfflineTaskRepository(engine).list())[0].completionPhotoUrl).toBe(savedPhotoUrl);
  });
});
