import type { StoredSession } from "../../domain/auth/auth.types";
import type {
  OfflineMutation, OfflineMutationKind, OfflinePayloads, OfflineScope,
  OfflineSnapshot, QueuedOfflineMutation, ShoppingOfflineState,
  ShoppingOfflineTransport,
} from "../../domain/shopping/offline.types";
import type { SecureStorage } from "../storage/secureStorage.adapter";
import { validateTaskCompletionPhoto } from "../../domain/task/taskCompletionPhoto";
import { RestClient } from "../api/restClient";
import { SessionRepository } from "../repositories/sessionRepository";
import { entityRevision, projectSnapshot, sanitizeSnapshot } from "./projection";

export const SHOPPING_SYNC_TAG = "khaneyar-shopping-sync";
const ACTIVE_KEY = "shopping-offline-active";
const INDEX_KEY = "shopping-offline-index";
const LOCK_NAME = "khaneyar-shopping-offline";
const CHANNEL_NAME = "khaneyar-shopping-offline-changed";
const MAX_PENDING = 200;
const MAX_OFFLINE_AGE = 7 * 24 * 60 * 60 * 1000;
const emptySnapshot = (): OfflineSnapshot => ({ lists: [], inventory: [], tasks: [] });

interface SavedOfflineState {
  version: 1;
  scope: OfflineScope;
  binding: string;
  generation: string;
  authorized: boolean;
  snapshot: OfflineSnapshot;
  pending: QueuedOfflineMutation[];
  lastSyncedAt: string | null;
  offline: boolean;
}

interface ActiveRecord { key: string; generation: string }

const localLocks = new Map<string, Promise<unknown>>();

async function withNamedLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(name, work);
  }
  // Non-browser unit execution. Browsers without Web Locks cannot enqueue.
  const result = (localLocks.get(name) ?? Promise.resolve()).then(work, work);
  localLocks.set(name, result.catch(() => undefined));
  return result;
}

const withLock = <T>(work: () => Promise<T>) => withNamedLock(LOCK_NAME, work);

interface SyncWork {
  key: string;
  generation: string;
  binding: string;
  token: string;
  operation: OfflineMutation | null;
}

function canPersist(storage: SecureStorage): boolean {
  return storage.persistent === true &&
    ((typeof window === "undefined" && typeof self === "undefined") ||
      (typeof navigator !== "undefined" && Boolean(navigator.locks)));
}

function knownOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function keyFor(scope: OfflineScope): string {
  return `shopping-offline:${scope.familyId}:${scope.memberId}`;
}

async function tokenBinding(token: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, "0")).join("");
}

function scopeValid(scope: OfflineScope): boolean {
  const age = Date.now() - Date.parse(scope.validatedAt);
  return Number.isFinite(age) && age >= -60_000 && age <= MAX_OFFLINE_AGE;
}

function failure(error: unknown): { kind: "network" | "auth" | "conflict" | "failed"; message: string } {
  const value = error as { code?: string; serverCode?: string; status?: number; message?: string } | null;
  const code = value?.code ?? value?.serverCode ?? "";
  const message = value?.message || "این تغییر به سرور نرسید؛ آن را بررسی کنید.";
  if (code === "NETWORK" || error instanceof TypeError || (value?.status ?? 0) >= 500) return { kind: "network", message };
  if (code === "TASK_FORBIDDEN" || value?.serverCode === "TASK_FORBIDDEN") return { kind: "failed", message };
  if (value?.status === 401 || value?.status === 403 || /SESSION_EXPIRED|UNAUTHORIZED|INVALID_TOKEN/.test(code)) {
    return { kind: "auth", message: "برای ارسال تغییرها دوباره وارد شوید." };
  }
  if (value?.status === 409 || /CONFLICT|OPERATION_REUSED/.test(code)) {
    return { kind: "conflict", message };
  }
  return { kind: "failed", message };
}

const payloadKeys: Record<OfflineMutationKind, readonly string[]> = {
  "list.create": ["title"], "list.update": ["title"], "list.delete": [],
  "item.create": ["list_id", "title", "qty", "unit", "note", "inventory_item_id"],
  "item.update": ["title", "qty", "unit", "note", "inventory_item_id"],
  "item.check": ["checked"], "item.delete": [],
  "inventory.create": ["title", "unit", "quantity", "threshold", "note"],
  "inventory.update": ["title", "unit", "quantity", "threshold", "note"],
  "inventory.adjust": ["delta"], "inventory.delete": [],
  "task.create": ["title", "description", "assignee_id", "due_date"],
  "task.update": ["title", "description", "assignee_id", "due_date"],
  "task.complete": ["completed", "completion_photo"], "task.delete": [],
};

function checkedPayload<K extends OfflineMutationKind>(kind: K, input: OfflinePayloads[K]): OfflinePayloads[K] {
  const allowed = payloadKeys[kind];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new Error("اطلاعات مالی یا فیلد ناشناخته در صف آفلاین مجاز نیست.");
    if (value !== undefined) result[key] = value;
  }
  if (allowed.includes("title")) {
    if (typeof result.title !== "string" || !result.title.trim()) throw new Error("نام را وارد کنید.");
    result.title = result.title.trim();
  }
  for (const field of ["qty", "quantity", "threshold", "delta"]) {
    const value = result[field];
    if (value !== undefined && value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("مقدار باید عدد معتبر باشد.");
    }
    if (typeof value === "number" && ((field === "qty" && value <= 0) ||
      ((field === "quantity" || field === "threshold") && value < 0))) {
      throw new Error("مقدار واردشده معتبر نیست.");
    }
  }
  if (kind === "item.check" && typeof result.checked !== "boolean") throw new Error("وضعیت قلم معتبر نیست.");
  if (kind === "inventory.adjust" && (typeof result.delta !== "number" || result.delta === 0)) {
    throw new Error("مقدار تغییر موجودی معتبر نیست.");
  }
  if (kind === "task.complete") {
    if (typeof result.completed !== "boolean") throw new Error("وضعیت انجام‌شدن معتبر نیست.");
    if (result.completion_photo !== undefined && result.completion_photo !== null) {
      if (!result.completed) throw new Error("عکس را فقط هنگام تأیید انجام کار می‌توانید اضافه کنید.");
      validateTaskCompletionPhoto(result.completion_photo);
    }
  }
  if (kind === "task.create" || kind === "task.update") {
    if ((result.title as string).length > 120) throw new Error("عنوان کار باید حداکثر ۱۲۰ نویسه باشد.");
    if (result.description !== undefined && result.description !== null) {
      if (typeof result.description !== "string" || result.description.length > 2000) {
        throw new Error("توضیح کار باید حداکثر ۲۰۰۰ نویسه باشد.");
      }
      result.description = result.description.trim() || null;
    }
    if (result.assignee_id !== undefined && result.assignee_id !== null &&
      (typeof result.assignee_id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.assignee_id))) {
      throw new Error("مسئول انتخاب‌شده معتبر نیست.");
    }
    if (result.due_date !== undefined && result.due_date !== null) {
      if (typeof result.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.due_date)) {
        throw new Error("موعد انتخاب‌شده معتبر نیست.");
      }
      const date = new Date(`${result.due_date}T12:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== result.due_date) {
        throw new Error("موعد انتخاب‌شده معتبر نیست.");
      }
    }
  }
  return result as OfflinePayloads[K];
}

function announce(): void {
  if (typeof BroadcastChannel === "undefined" || typeof self === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage("changed");
  channel.close();
}

/** Clear every partition on deliberate logout; a late reply cannot recreate it. */
export async function clearShoppingOffline(storage: SecureStorage): Promise<void> {
  await withLock(async () => {
    const keys = await storage.get<string[]>(INDEX_KEY) ?? [];
    const active = await storage.get<ActiveRecord>(ACTIVE_KEY);
    if (active && !keys.includes(active.key)) keys.push(active.key);
    for (const key of keys) await storage.remove(key);
    await storage.remove(ACTIVE_KEY);
    await storage.remove(INDEX_KEY);
  });
  announce();
}

export class ShoppingOfflineEngine {
  private readonly listeners = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;
  private syncing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onResume = () => { void this.sync().catch(() => this.notify()); };

  constructor(
    private readonly storage: SecureStorage,
    private readonly transport: ShoppingOfflineTransport,
  ) {
    this.channel = typeof BroadcastChannel !== "undefined" && typeof self !== "undefined"
      ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (this.channel) this.channel.onmessage = () => this.notify(false);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onResume);
      window.addEventListener("offline", this.onResume);
      window.addEventListener("focus", this.onResume);
      this.timer = setInterval(this.onResume, 30_000);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(broadcast = true): void {
    for (const listener of this.listeners) listener();
    if (broadcast) this.channel?.postMessage("changed");
  }

  private async sessionMatches(record: SavedOfflineState): Promise<StoredSession | null> {
    const session = await this.storage.get<StoredSession>("session");
    if (!session?.token || session.member.id !== record.scope.memberId ||
      session.family.id !== record.scope.familyId || await tokenBinding(session.token) !== record.binding) return null;
    return session;
  }

  private async record(): Promise<{ key: string; state: SavedOfflineState } | null> {
    const active = await this.storage.get<ActiveRecord>(ACTIVE_KEY);
    if (!active) return null;
    const state = await this.storage.get<SavedOfflineState>(active.key);
    if (!state || state.version !== 1 || state.generation !== active.generation ||
      !await this.sessionMatches(state)) return null;
    return { key: active.key, state };
  }

  async loadScope(): Promise<OfflineScope | null> {
    const record = await this.record();
    return record?.state.authorized && scopeValid(record.state.scope) && record.state.lastSyncedAt
      ? { ...record.state.scope } : null;
  }

  async initialize(scope: OfflineScope): Promise<ShoppingOfflineState> {
    const safeScope: OfflineScope = {
      familyId: scope.familyId, memberId: scope.memberId,
      familyName: scope.familyName, validatedAt: scope.validatedAt,
    };
    await withLock(async () => {
      const session = await this.storage.get<StoredSession>("session");
      if (!session?.token || session.member.id !== scope.memberId || session.family.id !== scope.familyId) {
        throw new Error("نشست این خانواده معتبر نیست.");
      }
      const key = keyFor(scope);
      const binding = await tokenBinding(session.token);
      const old = await this.storage.get<SavedOfflineState>(key);
      // initialize is called only after online authentication. A renewed token
      // for the same actor can rebind retained work; logout clears it explicitly.
      const sameActor = old?.version === 1 && old.scope.familyId === scope.familyId &&
        old.scope.memberId === scope.memberId;
      const state: SavedOfflineState = sameActor && old ? {
        ...old, scope: safeScope, authorized: true, binding,
        generation: crypto.randomUUID(),
        snapshot: sanitizeSnapshot(old.snapshot),
        pending: old.pending.map((entry) => entry.status === "auth" ? {
          operation: entry.operation, createdAt: entry.createdAt,
          dependsOn: entry.dependsOn, status: "pending",
        } : entry),
      } : {
        version: 1, scope: safeScope, binding, generation: crypto.randomUUID(),
        authorized: true, snapshot: emptySnapshot(), pending: [], lastSyncedAt: null,
        offline: knownOffline(),
      };
      await this.storage.set(key, state);
      await this.storage.set(ACTIVE_KEY, { key, generation: state.generation });
      // Inactive partitions stay encrypted and are never replayed as another
      // actor. Preserve them until that actor reauthenticates or deliberate logout.
      const keys = await this.storage.get<string[]>(INDEX_KEY) ?? [];
      await this.storage.set(INDEX_KEY, [...new Set([...keys, key])]);
    });
    this.notify();
    return this.readState();
  }

  async readState(): Promise<ShoppingOfflineState> {
    const record = await this.record();
    const state = record?.state;
    const authorized = Boolean(state?.authorized && scopeValid(state.scope));
    const snapshot = state && authorized ? sanitizeSnapshot(state.snapshot) : emptySnapshot();
    const pending = state?.pending.map((entry) => ({
      ...entry, operationId: entry.operation.operation_id,
      ...(entry.status !== "pending" ? { kind: entry.status } : {}),
    })) ?? [];
    return {
      scope: authorized && state ? { ...state.scope } : null,
      snapshot, view: authorized ? projectSnapshot(snapshot, pending, state?.scope.memberId) : emptySnapshot(),
      pending, issues: pending.filter((entry) => entry.status !== "pending"),
      lastSyncedAt: state?.lastSyncedAt ?? null, syncing: this.syncing,
      storageAvailable: canPersist(this.storage),
      offline: knownOffline() || (state?.offline ?? false),
    };
  }

  async mutate<K extends OfflineMutationKind>(
    kind: K, entityId: string, payload: OfflinePayloads[K], expectedRevision?: number,
  ): Promise<ShoppingOfflineState> {
    if (!canPersist(this.storage)) {
      throw new Error("این مرورگر ذخیره‌سازی امن آفلاین ندارد؛ برای تغییر اطلاعات به اینترنت وصل شوید.");
    }
    let queuedState!: ShoppingOfflineState;
    await withLock(async () => {
      const record = await this.record();
      if (!record?.state.authorized || !scopeValid(record.state.scope) || !record.state.lastSyncedAt) {
        throw new Error("برای آماده‌شدن اطلاعات آفلاین خانه، یک‌بار با اینترنت وارد شوید.");
      }
      const state = record.state;
      if (state.pending.length >= MAX_PENDING) throw new Error("صف تغییرها پر است؛ ابتدا به اینترنت وصل شوید.");
      if (state.pending.some((entry) => entry.status !== "pending")) {
        throw new Error("ابتدا تغییرهای نیازمند بررسی را تعیین تکلیف کنید.");
      }
      const checked = checkedPayload(kind, payload);
      const view = projectSnapshot(state.snapshot, state.pending, state.scope.memberId);
      const baseRevision = entityRevision(view, kind, entityId);
      if (!kind.endsWith(".create") && baseRevision === null) throw new Error("این قلم دیگر موجود نیست.");
      // Guard the revision the user actually saw, not a later background refresh.
      if (expectedRevision !== undefined && baseRevision !== expectedRevision) {
        throw new Error("این کار تغییر کرده است؛ نسخهٔ جدید را بررسی کنید.");
      }
      if (kind === "item.create" && !view.lists.some((list) => list.id === (checked as OfflinePayloads["item.create"]).list_id)) {
        throw new Error("لیست خرید موجود نیست.");
      }
      if (kind === "inventory.adjust") {
        const item = view.inventory.find((row) => row.id === entityId);
        if (item && item.quantity + (checked as OfflinePayloads["inventory.adjust"]).delta < 0) {
          throw new Error("موجودی نمی‌تواند منفی شود.");
        }
      }
      if ((kind === "task.create" || kind === "task.update") && (knownOffline() || state.offline)) {
        const assignee = (checked as OfflinePayloads["task.create"]).assignee_id;
        const current = view.tasks?.find((task) => task.id === entityId)?.assignee_id;
        if (assignee && assignee !== state.scope.memberId && assignee !== current) {
          throw new Error("برای انتخاب عضو دیگر به اینترنت وصل شوید؛ آفلاین می‌توانید خودتان یا بدون مسئول را انتخاب کنید.");
        }
      }
      const operation = {
        operation_id: crypto.randomUUID(), kind, entity_id: entityId,
        base_revision: baseRevision, payload: checked,
      } as OfflineMutation;
      state.pending.push({
        operation, createdAt: new Date().toISOString(), status: "pending",
        dependsOn: state.pending.map((entry) => entry.operation.operation_id),
      });
      state.offline = knownOffline() || state.offline;
      await this.storage.set(record.key, state);
      queuedState = await this.readState();
    });
    this.notify();
    this.registerBackgroundSync();
    // Enqueue has committed before network work; UI never waits on a failed fetch.
    if (!knownOffline()) void this.sync().catch(() => this.notify());
    return queuedState;
  }

  private registerBackgroundSync(): void {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
    void navigator.serviceWorker.ready.then((registration) => {
      const sync = (registration as ServiceWorkerRegistration & {
        sync?: { register(tag: string): Promise<void> };
      }).sync;
      return sync?.register(SHOPPING_SYNC_TAG);
    }).catch(() => undefined);
  }

  async refresh(): Promise<ShoppingOfflineState> {
    return this.sync();
  }

  private async selectSyncWork(): Promise<SyncWork | null> {
    return withLock(async () => {
      const record = await this.record();
      if (!record?.state.authorized || !scopeValid(record.state.scope)) return null;
      if (knownOffline()) {
        record.state.offline = true;
        await this.storage.set(record.key, record.state);
        return null;
      }
      const session = await this.sessionMatches(record.state);
      if (!session) return null;
      const entry = record.state.pending[0];
      return {
        key: record.key, generation: record.state.generation,
        binding: record.state.binding, token: session.token,
        operation: entry?.status === "pending" ? entry.operation : null,
      };
    });
  }

  private async rejectSyncWork(work: SyncWork, error: unknown): Promise<void> {
    let reason = failure(error);
    let latestSnapshot: OfflineSnapshot | null = null;
    if (reason.kind === "conflict") {
      try { latestSnapshot = sanitizeSnapshot(await this.transport.snapshot(work.token)); }
      catch (snapshotError) {
        const snapshotReason = failure(snapshotError);
        if (snapshotReason.kind === "auth") reason = snapshotReason;
      }
    }
    await withLock(async () => {
      const record = await this.record();
      if (!record || record.key !== work.key || record.state.generation !== work.generation ||
        record.state.binding !== work.binding) return;
      const state = record.state;
      if (reason.kind === "network") {
        state.offline = true;
        this.registerBackgroundSync();
      } else {
        state.offline = false;
        const entry = work.operation ? state.pending.find((item) =>
          item.operation.operation_id === work.operation?.operation_id) : undefined;
        if (entry) { entry.status = reason.kind; entry.message = reason.message; }
        if (reason.kind === "auth") { state.authorized = false; state.snapshot = emptySnapshot(); }
        else if (latestSnapshot) state.snapshot = latestSnapshot;
      }
      await this.storage.set(record.key, state);
    });
  }

  async sync(): Promise<ShoppingOfflineState> {
    this.syncing = true;
    this.notify();
    try {
      // A separate runner lock serializes delivery across page and worker.
      // State locks cover only storage work, so a slow fetch cannot block enqueue.
      await withNamedLock(`${LOCK_NAME}:sync`, async () => {
        for (let attempt = 0; attempt <= MAX_PENDING; attempt += 1) {
          const work = await this.selectSyncWork();
          if (!work) break;
          let snapshot: OfflineSnapshot;
          try {
            if (work.operation) {
              const result = await this.transport.mutate(work.operation, work.token);
              if (result.operation_id !== work.operation.operation_id || result.entity_id !== work.operation.entity_id) {
                throw new Error("پاسخ همگام‌سازی معتبر نیست؛ تغییر در صف باقی ماند.");
              }
              snapshot = sanitizeSnapshot(result.snapshot);
            } else snapshot = sanitizeSnapshot(await this.transport.snapshot(work.token));
          } catch (error) {
            await this.rejectSyncWork(work, error);
            break;
          }
          const continueDelivery = await withLock(async () => {
            // Reload to preserve writes appended while the request was in flight.
            const record = await this.record();
            if (!record || record.key !== work.key || record.state.generation !== work.generation ||
              record.state.binding !== work.binding) return false;
            const state = record.state;
            if (work.operation) {
              const operationId = work.operation.operation_id;
              state.pending = state.pending.filter((entry) => entry.operation.operation_id !== operationId);
              for (const following of state.pending) {
                following.dependsOn = following.dependsOn?.filter((id) => id !== operationId);
              }
            }
            state.snapshot = snapshot;
            state.lastSyncedAt = new Date().toISOString();
            state.scope.validatedAt = state.lastSyncedAt;
            state.offline = false;
            await this.storage.set(record.key, state);
            return Boolean(work.operation && state.pending[0]?.status === "pending");
          });
          this.notify();
          if (!continueDelivery) break;
        }
      });
    } finally {
      this.syncing = false;
      this.notify();
    }
    return this.readState();
  }

  async discard(operationId: string): Promise<ShoppingOfflineState> {
    await withLock(async () => {
      const record = await this.record();
      if (!record) return;
      record.state.pending = record.state.pending.filter((entry) => entry.operation.operation_id !== operationId);
      // A discarded prediction is not an acknowledged write. Reusing its numeric
      // revision could accidentally match another member's update and overwrite it.
      for (const following of record.state.pending) {
        if (following.dependsOn?.includes(operationId)) {
          following.status = "failed";
          following.message = "این تغییر به تغییر قبلی وابسته بود؛ آن را با اطلاعات جدید بررسی کنید.";
        }
      }
      await this.storage.set(record.key, record.state);
    });
    this.notify();
    void this.sync().catch(() => this.notify());
    return this.readState();
  }

  async clear(): Promise<void> {
    await clearShoppingOffline(this.storage);
    this.notify();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onResume);
      window.removeEventListener("offline", this.onResume);
      window.removeEventListener("focus", this.onResume);
    }
    this.channel?.close();
    this.listeners.clear();
  }
}

export function createShoppingOffline(
  storage: SecureStorage, transport?: ShoppingOfflineTransport,
): ShoppingOfflineEngine {
  const client = new RestClient(new SessionRepository(storage));
  return new ShoppingOfflineEngine(storage, transport ?? {
    snapshot: (token) => client.get<OfflineSnapshot>("/shopping/offline", { bearer: token }),
    mutate: (operation, token) => client.post("/shopping/offline/mutations", operation, { bearer: token }),
  });
}
