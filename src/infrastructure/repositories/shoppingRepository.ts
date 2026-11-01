/* مخزنِ §۱.۸ خرید و انبار — اندپوینت‌های REST بک‌اند.

   نام‌گذاری بدون پیشوند «Supabase» چون از ابتدا REST-محور است (همان قاعدهٔ
   billRepository و notificationRepository).

   عدد روی سیم می‌تواند **رشته** باشد: ستون‌های Numeric پستگرس در JSON
   رشته می‌شوند. `Number()` یک‌بار همین‌جا انجام می‌شود تا هیچ مصرف‌کننده‌ای
   مجبور نباشد حدس بزند — عیناً مثلِ مبلغِ تراکنش و قبض. */

import type {
  InventoryRepository,
  ShoppingRepository,
} from "@/domain/shopping/shopping.repository";
import type {
  InventoryInput,
  InventoryItem,
  ShoppingItem,
  ShoppingItemInput,
  ShoppingList,
  TripInput,
  TripResult,
} from "@/domain/shopping/shopping.types";
import type { RestClient } from "@/infrastructure/api/restClient";

type ItemRow = {
  id: string;
  list_id: string;
  title: string;
  qty: string | number;
  unit: string | null;
  price: string | number | null;
  checked: boolean;
  bought_at: string | null;
  bought_by_member_id: string | null;
  transaction_id: string | null;
  inventory_item_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

type ListRow = {
  id: string;
  title: string;
  created_by: string | null;
  created_at: string;
  items: ItemRow[] | null;
};

type TripRow = {
  list: ListRow;
  total: string | number;
  item_count: number;
  transaction_id: string | null;
};

type InventoryRow = {
  id: string;
  title: string;
  unit: string | null;
  quantity: string | number;
  threshold: string | number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/* عددِ نبود/نامعتبر → صفر، نه NaN. یک NaN در جمعِ قیمت‌ها کلِ «جمعِ سبد»
   را به NaN می‌برد و کاربر «NaN تومان» می‌دید. */
function num(value: string | number | null | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/* قیمت فرق دارد: `null` معنا دارد («قیمت نگفتم») و نباید به صفر بیفتد،
   وگرنه «قیمت نگفتم» با «مجانی» قاطی می‌شد و هشدارِ «جمع ناقص است» از
   کار می‌افتاد. */
function priceOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapItem(r: ItemRow): ShoppingItem {
  return {
    id: r.id,
    listId: r.list_id,
    title: r.title,
    qty: num(r.qty) || 1,
    unit: r.unit ?? null,
    price: priceOrNull(r.price),
    checked: Boolean(r.checked),
    boughtAt: r.bought_at ?? null,
    boughtByMemberId: r.bought_by_member_id ?? null,
    transactionId: r.transaction_id ?? null,
    inventoryItemId: r.inventory_item_id ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  };
}

function mapList(r: ListRow): ShoppingList {
  return {
    id: r.id,
    title: r.title,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    items: (r.items ?? []).map(mapItem),
  };
}

function mapInventory(r: InventoryRow): InventoryItem {
  return {
    id: r.id,
    title: r.title,
    unit: r.unit ?? null,
    quantity: num(r.quantity),
    threshold: num(r.threshold),
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function itemBody(input: ShoppingItemInput): Record<string, unknown> {
  return {
    title: input.title,
    qty: input.qty ?? null,
    unit: input.unit ?? null,
    price: input.price ?? null,
    note: input.note ?? null,
    inventory_item_id: input.inventoryItemId ?? null,
  };
}

export class RestShoppingRepository implements ShoppingRepository {
  constructor(private readonly client: RestClient) {}

  async listLists(): Promise<ShoppingList[]> {
    const rows = await this.client.get<ListRow[]>("/shopping/lists");
    return (rows ?? []).map(mapList);
  }

  async addList(title: string): Promise<ShoppingList> {
    return mapList(
      await this.client.post<ListRow>("/shopping/lists", { title }),
    );
  }

  async renameList(id: string, title: string): Promise<ShoppingList> {
    return mapList(
      await this.client.patch<ListRow>(
        `/shopping/lists/${encodeURIComponent(id)}`,
        { title },
      ),
    );
  }

  async removeList(id: string): Promise<void> {
    await this.client.del<void>(
      `/shopping/lists/${encodeURIComponent(id)}`,
    );
  }

  async addItem(
    listId: string,
    input: ShoppingItemInput,
  ): Promise<ShoppingItem> {
    return mapItem(
      await this.client.post<ItemRow>(
        `/shopping/lists/${encodeURIComponent(listId)}/items`,
        itemBody(input),
      ),
    );
  }

  async updateItem(
    itemId: string,
    input: ShoppingItemInput,
  ): Promise<ShoppingItem> {
    return mapItem(
      await this.client.patch<ItemRow>(
        `/shopping/items/${encodeURIComponent(itemId)}`,
        itemBody(input),
      ),
    );
  }

  async checkItem(itemId: string, checked: boolean): Promise<ShoppingItem> {
    return mapItem(
      await this.client.post<ItemRow>(
        `/shopping/items/${encodeURIComponent(itemId)}/check`,
        { checked },
      ),
    );
  }

  async removeItem(itemId: string): Promise<void> {
    await this.client.del<void>(
      `/shopping/items/${encodeURIComponent(itemId)}`,
    );
  }

  async completeTrip(listId: string, input: TripInput): Promise<TripResult> {
    const row = await this.client.post<TripRow>(
      `/shopping/lists/${encodeURIComponent(listId)}/complete`,
      {
        account_id: input.accountId ?? null,
        date: input.date ?? null,
        create_transaction: input.createTransaction ?? true,
      },
    );
    return {
      list: mapList(row.list),
      total: num(row.total),
      itemCount: Number(row.item_count) || 0,
      transactionId: row.transaction_id ?? null,
    };
  }
}

export class RestInventoryRepository implements InventoryRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<InventoryItem[]> {
    const rows = await this.client.get<InventoryRow[]>("/inventory");
    return (rows ?? []).map(mapInventory);
  }

  async add(input: InventoryInput): Promise<InventoryItem> {
    return mapInventory(
      await this.client.post<InventoryRow>("/inventory", body(input)),
    );
  }

  async update(id: string, input: InventoryInput): Promise<InventoryItem> {
    return mapInventory(
      await this.client.patch<InventoryRow>(
        `/inventory/${encodeURIComponent(id)}`,
        body(input),
      ),
    );
  }

  async adjust(id: string, delta: number): Promise<InventoryItem> {
    return mapInventory(
      await this.client.post<InventoryRow>(
        `/inventory/${encodeURIComponent(id)}/adjust`,
        { delta },
      ),
    );
  }

  async remove(id: string): Promise<void> {
    await this.client.del<void>(`/inventory/${encodeURIComponent(id)}`);
  }
}

function body(input: InventoryInput): Record<string, unknown> {
  return {
    title: input.title,
    unit: input.unit ?? null,
    quantity: input.quantity ?? null,
    threshold: input.threshold ?? null,
    note: input.note ?? null,
  };
}
