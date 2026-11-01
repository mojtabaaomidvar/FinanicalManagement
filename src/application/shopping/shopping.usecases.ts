/* Use-caseهای §۱.۸ خرید و انبار — orchestration بدون UI و بدون state. */

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

export class ListShoppingListsUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(): Promise<ShoppingList[]> {
    return this.repo.listLists();
  }
}

export class AddShoppingListUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(title: string): Promise<ShoppingList> {
    return this.repo.addList(title);
  }
}

export class RenameShoppingListUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(id: string, title: string): Promise<ShoppingList> {
    return this.repo.renameList(id, title);
  }
}

export class DeleteShoppingListUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.removeList(id);
  }
}

export class AddShoppingItemUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(listId: string, input: ShoppingItemInput): Promise<ShoppingItem> {
    return this.repo.addItem(listId, input);
  }
}

export class UpdateShoppingItemUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(itemId: string, input: ShoppingItemInput): Promise<ShoppingItem> {
    return this.repo.updateItem(itemId, input);
  }
}

export class CheckShoppingItemUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(itemId: string, checked: boolean): Promise<ShoppingItem> {
    return this.repo.checkItem(itemId, checked);
  }
}

export class DeleteShoppingItemUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(itemId: string): Promise<void> {
    return this.repo.removeItem(itemId);
  }
}

/** «خرید انجام شد» — سه چیز را هم‌زمان عوض می‌کند: اقلامِ لیست، یک تراکنشِ
 *  هزینه، و موجودیِ انبار (رابطهٔ Shopping ↕ Finance، §۴.۷). همه در یک
 *  commitِ سروری. پس فراخوان **باید** بعدش `refreshData` بزند، وگرنه
 *  خرجِ ماه و انبار در صفحه کهنه می‌مانند. */
export class CompleteTripUseCase {
  constructor(private readonly repo: ShoppingRepository) {}
  execute(listId: string, input: TripInput): Promise<TripResult> {
    return this.repo.completeTrip(listId, input);
  }
}

export class ListInventoryUseCase {
  constructor(private readonly repo: InventoryRepository) {}
  execute(): Promise<InventoryItem[]> {
    return this.repo.list();
  }
}

export class AddInventoryItemUseCase {
  constructor(private readonly repo: InventoryRepository) {}
  execute(input: InventoryInput): Promise<InventoryItem> {
    return this.repo.add(input);
  }
}

export class UpdateInventoryItemUseCase {
  constructor(private readonly repo: InventoryRepository) {}
  execute(id: string, input: InventoryInput): Promise<InventoryItem> {
    return this.repo.update(id, input);
  }
}

/** تغییرِ **نسبی** موجودی. نسبی است نه مطلق، چون دو نفر می‌توانند هم‌زمان
 *  انبار را دست بزنند و «بگذار روی ۳» آخرین‌نویسنده-برنده است. */
export class AdjustInventoryUseCase {
  constructor(private readonly repo: InventoryRepository) {}
  execute(id: string, delta: number): Promise<InventoryItem> {
    return this.repo.adjust(id, delta);
  }
}

export class DeleteInventoryItemUseCase {
  constructor(private readonly repo: InventoryRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
