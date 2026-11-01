/* §۱.۸ — درزِ مخزنِ خرید و انبار (پیاده‌سازی در infrastructure).

   `checked` و `boughtAt` در `ShoppingItemInput` نیستند و این عمدی است:
   حالت فقط با کنش عوض می‌شود (`check` / `completeTrip`)، نه با یک ویرایشِ
   آزاد. وگرنه کلاینت می‌توانست قلم را «خریده‌شده» کند بی‌آنکه خرجی ثبت شود
   یا موجودیِ انبار بالا برود — همان قاعدهٔ `BillRepository`. */

import type {
  InventoryInput,
  InventoryItem,
  ShoppingItem,
  ShoppingItemInput,
  ShoppingList,
  TripInput,
  TripResult,
} from "./shopping.types";

export interface ShoppingRepository {
  /** همهٔ لیست‌ها با اقلامِ **نخریده‌شان** — ترتیب از سرور می‌آید */
  listLists(): Promise<ShoppingList[]>;
  addList(title: string): Promise<ShoppingList>;
  renameList(id: string, title: string): Promise<ShoppingList>;
  removeList(id: string): Promise<void>;

  addItem(listId: string, input: ShoppingItemInput): Promise<ShoppingItem>;
  updateItem(itemId: string, input: ShoppingItemInput): Promise<ShoppingItem>;
  /** تیکِ «در سبد است» — هیچ تراکنشی نمی‌سازد، پس آزاد است */
  checkItem(itemId: string, checked: boolean): Promise<ShoppingItem>;
  removeItem(itemId: string): Promise<void>;

  /** «خرید انجام شد» — تراکنشِ هزینه + مهرِ خرید + بالا رفتنِ انبار، یک commit */
  completeTrip(listId: string, input: TripInput): Promise<TripResult>;
}

export interface InventoryRepository {
  /** کم‌شده‌ها اول — ترتیب از سرور می‌آید */
  list(): Promise<InventoryItem[]>;
  add(input: InventoryInput): Promise<InventoryItem>;
  update(id: string, input: InventoryInput): Promise<InventoryItem>;
  /** تغییرِ **نسبی** (+۱ / −۱) — نه مطلق، چون دو نفر هم‌زمان دست می‌زنند */
  adjust(id: string, delta: number): Promise<InventoryItem>;
  remove(id: string): Promise<void>;
}
