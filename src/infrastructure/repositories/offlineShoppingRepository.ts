import type { ShoppingRepository, InventoryRepository } from "@/domain/shopping/shopping.repository";
import type { InventoryInput, InventoryItem, ShoppingItemInput, ShoppingItem, ShoppingList, TripInput, TripResult } from "@/domain/shopping/shopping.types";
import { offlineLists, offlineInventory } from "@/domain/shopping/offline.view";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import { AppError, isAppError } from "@/shared/lib/appError";

const noNetwork = () => typeof navigator !== "undefined" && navigator.onLine === false;
const requiresConnection = () => new AppError("NETWORK", "این کار به اتصال اینترنت نیاز دارد؛ خرید و تغییرهای انبار را می‌توانید آفلاین انجام دهید.");

export class OfflineShoppingRepository implements ShoppingRepository {
  constructor(private readonly online: ShoppingRepository, private readonly engine: ShoppingOfflineEngine) {}

  private async local() {
    const state = await this.engine.readState();
    return { state, offline: noNetwork() || state.offline };
  }

  async listLists(): Promise<ShoppingList[]> {
    const { state, offline } = await this.local();
    if (offline) return offlineLists(state.view);
    try {
      const rows = await this.online.listLists();
      if (!state.pending.length) return rows;
      const existingItems = new Map(rows.flatMap((row) => row.items.map((item) => [item.id, item] as const)));
      return offlineLists(state.view).map((row) => ({ ...row, items: row.items.map((item) => ({
        ...item, price: existingItems.get(item.id)?.price ?? null,
      })) }));
    } catch (error) {
      if (!isAppError(error) || error.code !== "NETWORK") throw error;
      await this.engine.refresh();
      return offlineLists((await this.engine.readState()).view);
    }
  }

  async addList(title: string): Promise<ShoppingList> {
    const id = crypto.randomUUID();
    const state = await this.engine.mutate("list.create", id, { title });
    return offlineLists(state.view).find((row) => row.id === id)!;
  }

  async renameList(id: string, title: string): Promise<ShoppingList> {
    const state = await this.engine.mutate("list.update", id, { title });
    return offlineLists(state.view).find((row) => row.id === id)!;
  }

  async removeList(id: string): Promise<void> { await this.engine.mutate("list.delete", id, {}); }

  async addItem(listId: string, input: ShoppingItemInput): Promise<ShoppingItem> {
    const { offline } = await this.local();
    if (input.price !== undefined) {
      if (offline && input.price !== null) throw requiresConnection();
      if (!offline) {
        await this.requireSynced();
        const result = await this.online.addItem(listId, input);
        await this.engine.refresh();
        return result;
      }
    }
    const id = crypto.randomUUID();
    const state = await this.engine.mutate("item.create", id, { list_id: listId, ...itemPayload(input) });
    return offlineLists(state.view).flatMap((row) => row.items).find((row) => row.id === id)!;
  }

  async updateItem(id: string, input: ShoppingItemInput): Promise<ShoppingItem> {
    const { offline } = await this.local();
    if (input.price !== undefined) {
      if (offline && input.price !== null) throw requiresConnection();
      if (!offline) {
        await this.requireSynced();
        const result = await this.online.updateItem(id, input);
        await this.engine.refresh();
        return result;
      }
    }
    const state = await this.engine.mutate("item.update", id, itemPayload(input));
    return offlineLists(state.view).flatMap((row) => row.items).find((row) => row.id === id)!;
  }

  async checkItem(id: string, checked: boolean): Promise<ShoppingItem> {
    const state = await this.engine.mutate("item.check", id, { checked });
    return offlineLists(state.view).flatMap((row) => row.items).find((row) => row.id === id)!;
  }

  async removeItem(id: string): Promise<void> { await this.engine.mutate("item.delete", id, {}); }

  async completeTrip(id: string, input: TripInput): Promise<TripResult> {
    if ((await this.local()).offline) throw requiresConnection();
    const state = await this.engine.sync();
    if (state.offline) throw requiresConnection();
    if (state.pending.length) throw new AppError("CONFLICT", "ابتدا تغییرهای این دستگاه باید به سرور برسند؛ وضعیت همگام‌سازی را بررسی کنید.");
    const result = await this.online.completeTrip(id, input);
    await this.engine.refresh();
    return result;
  }

  private async requireSynced(): Promise<void> {
    const state = await this.engine.sync();
    if (state.offline) throw requiresConnection();
    if (state.pending.length) throw new AppError("CONFLICT", "پیش از ثبت قیمت، تغییرهای این دستگاه باید ارسال یا بررسی شوند.");
  }
}

function itemPayload(input: ShoppingItemInput) {
  return { title: input.title, qty: input.qty ?? 1, unit: input.unit ?? null,
    note: input.note ?? null, inventory_item_id: input.inventoryItemId ?? null };
}

export class OfflineInventoryRepository implements InventoryRepository {
  constructor(private readonly online: InventoryRepository, private readonly engine: ShoppingOfflineEngine) {}

  async list(): Promise<InventoryItem[]> {
    const state = await this.engine.readState();
    if (noNetwork() || state.offline || state.pending.length) return offlineInventory(state.view);
    try { return await this.online.list(); }
    catch (error) {
      if (!isAppError(error) || error.code !== "NETWORK") throw error;
      await this.engine.refresh();
      return offlineInventory((await this.engine.readState()).view);
    }
  }
  async add(input: InventoryInput): Promise<InventoryItem> {
    const id = crypto.randomUUID();
    const state = await this.engine.mutate("inventory.create", id, inventoryPayload(input));
    return offlineInventory(state.view).find((row) => row.id === id)!;
  }
  async update(id: string, input: InventoryInput): Promise<InventoryItem> {
    const state = await this.engine.mutate("inventory.update", id, inventoryPayload(input));
    return offlineInventory(state.view).find((row) => row.id === id)!;
  }
  async adjust(id: string, delta: number): Promise<InventoryItem> {
    const state = await this.engine.mutate("inventory.adjust", id, { delta });
    return offlineInventory(state.view).find((row) => row.id === id)!;
  }
  async remove(id: string): Promise<void> { await this.engine.mutate("inventory.delete", id, {}); }
}

function inventoryPayload(input: InventoryInput) {
  return { title: input.title, unit: input.unit ?? null, quantity: input.quantity ?? 0,
    threshold: input.threshold ?? 0, note: input.note ?? null };
}
