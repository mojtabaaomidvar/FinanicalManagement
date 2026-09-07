/* انتیتی دسته سفارشی — ساخته‌شده توسط خانواده (برای همیشه ذخیره می‌شود) */

import type { TxType } from "../transaction/transaction.types";

export interface CustomCategory {
  id: string;
  familyId: string;
  type: TxType;
  name: string;
  createdAt: string;
}

export interface CustomCategoryRepository {
  list(): Promise<CustomCategory[]>;
  /** افزودن (تکراری → همان موجود) */
  add(type: TxType, name: string): Promise<CustomCategory>;
  /** حذف — فقط وقتی هیچ تراکنشی به این دسته ارجاع ندارد (سرور چک می‌کند) */
  remove(id: string): Promise<void>;
}
