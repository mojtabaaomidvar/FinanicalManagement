import type {
  OfflineInventoryItem,
  OfflineMutationKind,
  OfflineSnapshot,
  QueuedOfflineMutation,
} from "../../domain/shopping/offline.types";

/** Select fields explicitly: a future API extension cannot leak into the cache. */
export function sanitizeSnapshot(source: OfflineSnapshot): OfflineSnapshot {
  const prefs = source.task_notification_prefs;
  const lead = prefs?.lead_days;
  return {
    lists: source.lists.map((list) => ({
      id: list.id, title: list.title, revision: list.revision,
      created_at: list.created_at,
      items: list.items.map((item) => ({
        id: item.id, list_id: item.list_id, title: item.title, qty: item.qty,
        unit: item.unit, checked: item.checked,
        inventory_item_id: item.inventory_item_id, note: item.note,
        revision: item.revision, created_at: item.created_at,
      })),
    })),
    inventory: source.inventory.map((item) => ({
      id: item.id, title: item.title, unit: item.unit, quantity: item.quantity,
      category: item.category ?? null, note: item.note, revision: item.revision,
      created_at: item.created_at, updated_at: item.updated_at,
    })),
    tasks: (source.tasks ?? []).map((task) => ({
      id: task.id, title: task.title, description: task.description,
      assignee_id: task.assignee_id, due_date: task.due_date,
      completed: task.completed, completed_at: task.completed_at,
      completed_by: task.completed_by, created_by: task.created_by,
      completion_photo_url: task.completion_photo_url ?? null,
      revision: task.revision, created_at: task.created_at, updated_at: task.updated_at,
    })),
    task_notification_prefs: {
      enabled: typeof prefs?.enabled === "boolean" ? prefs.enabled : true,
      tasks_enabled: typeof prefs?.tasks_enabled === "boolean" ? prefs.tasks_enabled : true,
      lead_days: typeof lead === "number" && Number.isFinite(lead)
        ? Math.min(60, Math.max(0, Math.floor(lead))) : 0,
    },
  };
}

export function entityRevision(
  snapshot: OfflineSnapshot, kind: OfflineMutationKind, id: string,
): number | null {
  if (kind.endsWith(".create")) return null;
  if (kind.startsWith("list.")) {
    return snapshot.lists.find((list) => list.id === id)?.revision ?? null;
  }
  if (kind.startsWith("inventory.")) {
    return snapshot.inventory.find((item) => item.id === id)?.revision ?? null;
  }
  if (kind.startsWith("task.")) {
    return snapshot.tasks?.find((task) => task.id === id)?.revision ?? null;
  }
  return snapshot.lists.flatMap((list) => list.items)
    .find((item) => item.id === id)?.revision ?? null;
}

/** Pending own writes predict exactly the server's row and parent revisions. */
export function projectSnapshot(
  base: OfflineSnapshot, queue: QueuedOfflineMutation[], actorId?: string,
): OfflineSnapshot {
  const view = sanitizeSnapshot(base);
  for (const entry of queue) {
    // A conflict exposes server truth; later dependent writes remain in the outbox.
    if (entry.status !== "pending") break;
    const op = entry.operation;
    const id = op.entity_id;
    switch (op.kind) {
      case "list.create":
        view.lists.unshift({
          id, title: op.payload.title, revision: 1, created_at: entry.createdAt,
          items: [],
        });
        break;
      case "list.update": {
        const list = view.lists.find((row) => row.id === id);
        if (list) { list.title = op.payload.title; list.revision += 1; }
        break;
      }
      case "list.delete":
        view.lists = view.lists.filter((row) => row.id !== id);
        break;
      case "item.create": {
        const list = view.lists.find((row) => row.id === op.payload.list_id);
        if (list) {
          list.items.push({
            id, list_id: list.id, title: op.payload.title, qty: op.payload.qty ?? 1,
            unit: op.payload.unit ?? null, checked: false,
            inventory_item_id: op.payload.inventory_item_id ?? null,
            note: op.payload.note ?? null, revision: 1, created_at: entry.createdAt,
          });
          list.revision += 1;
        }
        break;
      }
      case "item.update":
      case "item.check":
      case "item.delete": {
        const list = view.lists.find((row) => row.items.some((item) => item.id === id));
        const item = list?.items.find((row) => row.id === id);
        if (!list || !item) break;
        if (op.kind === "item.delete") {
          list.items = list.items.filter((row) => row.id !== id);
        } else if (op.kind === "item.check") {
          item.checked = op.payload.checked;
          item.revision += 1;
        } else {
          item.title = op.payload.title;
          if (op.payload.qty !== undefined) item.qty = op.payload.qty ?? 1;
          if (op.payload.unit !== undefined) item.unit = op.payload.unit;
          if (op.payload.note !== undefined) item.note = op.payload.note;
          if (op.payload.inventory_item_id !== undefined) {
            item.inventory_item_id = op.payload.inventory_item_id;
          }
          item.revision += 1;
        }
        list.revision += 1;
        break;
      }
      case "inventory.create":
        view.inventory.push({
          id, title: op.payload.title, unit: op.payload.unit ?? null,
          quantity: op.payload.quantity ?? 0, category: op.payload.category ?? null,
          note: op.payload.note ?? null, revision: 1,
          created_at: entry.createdAt, updated_at: entry.createdAt,
        });
        break;
      case "inventory.update":
      case "inventory.adjust": {
        const item = view.inventory.find((row) => row.id === id);
        if (!item) break;
        if (op.kind === "inventory.adjust") {
          item.quantity = Math.max(0, Math.round((item.quantity + op.payload.delta) * 100) / 100);
        } else {
          item.title = op.payload.title;
          if (op.payload.unit !== undefined) item.unit = op.payload.unit;
          if (op.payload.quantity !== undefined) item.quantity = op.payload.quantity ?? 0;
          if (op.payload.category !== undefined) item.category = op.payload.category;
          if (op.payload.note !== undefined) item.note = op.payload.note;
        }
        item.revision += 1;
        item.updated_at = entry.createdAt;
        break;
      }
      case "inventory.delete":
        view.inventory = view.inventory.filter((row) => row.id !== id);
        break;
      case "task.create":
        if (!actorId) break;
        view.tasks!.unshift({
          id, title: op.payload.title, description: op.payload.description ?? null,
          assignee_id: op.payload.assignee_id ?? null, due_date: op.payload.due_date ?? null,
          completed: false, completed_at: null, completed_by: null,
          completion_photo_url: null,
          created_by: actorId, revision: 1, created_at: entry.createdAt,
          updated_at: entry.createdAt,
        });
        break;
      case "task.update": {
        const task = view.tasks!.find((row) => row.id === id);
        if (!task) break;
        task.title = op.payload.title;
        task.description = op.payload.description ?? null;
        task.assignee_id = op.payload.assignee_id ?? null;
        task.due_date = op.payload.due_date ?? null;
        task.revision += 1;
        task.updated_at = entry.createdAt;
        break;
      }
      case "task.complete": {
        const task = view.tasks!.find((row) => row.id === id);
        if (!task || !actorId) break;
        if (task.completed !== op.payload.completed) {
          task.completed = op.payload.completed;
          task.completed_at = op.payload.completed ? entry.createdAt : null;
          task.completed_by = op.payload.completed ? actorId : null;
          task.completion_photo_url = null;
        }
        if (!op.payload.completed) task.completion_photo_url = null;
        else if (op.payload.completion_photo != null) {
          task.completion_photo_url = op.payload.completion_photo;
        }
        task.revision += 1;
        task.updated_at = entry.createdAt;
        break;
      }
      case "task.delete":
        view.tasks = view.tasks!.filter((row) => row.id !== id);
        break;
    }
  }
  view.inventory.sort((a: OfflineInventoryItem, b: OfflineInventoryItem) => {
    return a.title.localeCompare(b.title, "fa");
  });
  return view;
}
