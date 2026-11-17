import type { OfflineSnapshot } from "./offline.types";
import type { InventoryItem, ShoppingList } from "./shopping.types";

export function offlineLists(snapshot: OfflineSnapshot): ShoppingList[] {
  return snapshot.lists.map((list) => ({
    id: list.id, title: list.title, createdAt: list.created_at, createdBy: null,
    items: list.items.map((item) => ({
      id: item.id, listId: item.list_id, title: item.title, qty: item.qty,
      unit: item.unit, checked: item.checked, inventoryItemId: item.inventory_item_id,
      note: item.note, createdAt: item.created_at, createdBy: null,
      price: null, transactionId: null, boughtAt: null, boughtByMemberId: null,
    })),
  }));
}

export function offlineInventory(snapshot: OfflineSnapshot): InventoryItem[] {
  return snapshot.inventory.map((item) => ({
    id: item.id, title: item.title, quantity: item.quantity, threshold: item.threshold,
    unit: item.unit, note: item.note, createdAt: item.created_at, updatedAt: item.updated_at,
    createdBy: null,
  }));
}
