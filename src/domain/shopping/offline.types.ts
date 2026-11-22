/** Narrow household DTOs: prices, finance links and membership data are absent. */
export interface OfflineShoppingItem {
  id: string;
  list_id: string;
  title: string;
  qty: number;
  unit: string | null;
  checked: boolean;
  inventory_item_id: string | null;
  note: string | null;
  revision: number;
  created_at: string;
}

export interface OfflineShoppingList {
  id: string;
  title: string;
  revision: number;
  created_at: string;
  items: OfflineShoppingItem[];
}

export interface OfflineInventoryItem {
  id: string;
  title: string;
  unit: string | null;
  quantity: number;
  /** Optional only for snapshots encrypted before categories were introduced. */
  category?: string | null;
  note: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface OfflineSnapshot {
  lists: OfflineShoppingList[];
  inventory: OfflineInventoryItem[];
  /** Missing in snapshots saved before the tasks module was installed. */
  tasks?: OfflineTask[];
  /** Only the preferences necessary to honor offline task reminders. */
  task_notification_prefs?: OfflineTaskNotificationPrefs;
}

export interface OfflineTaskNotificationPrefs {
  enabled: boolean;
  tasks_enabled: boolean;
  lead_days: number;
}

/** Shared task content and actor references only; member profiles stay online. */
export interface OfflineTask {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  /** Server URL, or the queued data URL before synchronization. */
  completion_photo_url?: string | null;
  created_by: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface OfflineTaskFields {
  title: string;
  description?: string | null;
  assignee_id?: string | null;
  due_date?: string | null;
}

interface ItemFields {
  title: string;
  qty?: number | null;
  unit?: string | null;
  note?: string | null;
  inventory_item_id?: string | null;
}

interface InventoryFields {
  title: string;
  unit?: string | null;
  quantity?: number | null;
  category?: string | null;
  note?: string | null;
}

export interface OfflinePayloads {
  "list.create": { title: string };
  "list.update": { title: string };
  "list.delete": Record<string, never>;
  "item.create": ItemFields & { list_id: string };
  "item.update": ItemFields;
  "item.check": { checked: boolean };
  "item.delete": Record<string, never>;
  "inventory.create": InventoryFields;
  "inventory.update": InventoryFields;
  "inventory.adjust": { delta: number };
  "inventory.delete": Record<string, never>;
  "task.create": OfflineTaskFields;
  "task.update": OfflineTaskFields;
  "task.complete": { completed: boolean; completion_photo?: string | null };
  "task.delete": Record<string, never>;
}

export type OfflineMutationKind = keyof OfflinePayloads;

export type OfflineMutation = {
  [K in OfflineMutationKind]: {
    operation_id: string;
    kind: K;
    entity_id: string;
    base_revision: number | null;
    payload: OfflinePayloads[K];
  };
}[OfflineMutationKind];

export interface OfflineMutationResult {
  operation_id: string;
  replayed: boolean;
  entity_type: "list" | "item" | "inventory" | "task";
  entity_id: string;
  revision: number | null;
  snapshot: OfflineSnapshot;
}

/** Last online validation, without phone, role, budget or family membership list. */
export interface OfflineScope {
  familyId: string;
  memberId: string;
  familyName: string;
  validatedAt: string;
}

export type OfflineIssueKind = "conflict" | "failed" | "auth";

export interface QueuedOfflineMutation {
  operation: OfflineMutation;
  createdAt: string;
  status: "pending" | OfflineIssueKind;
  message?: string;
  operationId?: string;
  kind?: OfflineIssueKind;
  /** Earlier own writes whose predicted revisions this operation used. */
  dependsOn?: string[];
}

export interface ShoppingOfflineState {
  scope: OfflineScope | null;
  snapshot: OfflineSnapshot;
  view: OfflineSnapshot;
  pending: QueuedOfflineMutation[];
  issues: QueuedOfflineMutation[];
  lastSyncedAt: string | null;
  syncing: boolean;
  storageAvailable: boolean;
  offline: boolean;
}

export type OfflineSyncState = ShoppingOfflineState;

export interface ShoppingOfflineTransport {
  snapshot(token: string): Promise<OfflineSnapshot>;
  mutate(operation: OfflineMutation, token: string): Promise<OfflineMutationResult>;
}
