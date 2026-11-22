import type { InventoryItem, ShoppingList } from "@/domain/shopping/shopping.types";
import { roundQty } from "@/domain/shopping/shopping.rules";
import { inventoryCategory, type InventoryCatalogGroup } from "./inventory.catalog";
import { toEn, toFa } from "@/shared/lib/digits";

export type InventoryFilter = "all" | "empty";
export const MAX_INVENTORY_QUANTITY = 99_999_999;

/** Validate the whole input; invalid text and negative values never become zero. */
export function parseInventoryQuantity(raw: string, allowZero = true): number | null {
  const normalized = toEn(raw).replace(/[٬،,\s_]/g, "").replace(/٫/g, ".");
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number > MAX_INVENTORY_QUANTITY) return null;
  const result = roundQty(number);
  return result < 0 || (!allowZero && result === 0) ? null : result;
}

/** Keep invalid characters visible so validation can explain the input. */
export function liveInventoryQuantity(raw: string): string {
  return toFa(raw).replace(/\./g, "٫");
}

function searchKey(value: string): string {
  return value.toLocaleLowerCase("fa-IR").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[\s\u200c]+/g, " ").trim();
}

export function filterInventory(items: InventoryItem[], filter: InventoryFilter, query: string,
  categories: readonly InventoryCatalogGroup[] | "uncategorized" | null = null): InventoryItem[] {
  const search = searchKey(query);
  return items.filter(item => (filter === "all" || item.quantity === 0)
    && (categories === null || (categories === "uncategorized" ? inventoryCategory(item) === null
      : categories.includes(inventoryCategory(item)!)))
    && (!search || searchKey([item.title, item.unit ?? "", item.note ?? ""].join(" ")).includes(search)));
}

export function inventoryShoppingLists(lists: ShoppingList[]): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const list of lists) {
    for (const item of list.items) {
      if (!item.inventoryItemId || item.boughtAt) continue;
      const titles = result.get(item.inventoryItemId) ?? [];
      if (!titles.includes(list.title)) titles.push(list.title);
      result.set(item.inventoryItemId, titles);
    }
  }
  return result;
}
