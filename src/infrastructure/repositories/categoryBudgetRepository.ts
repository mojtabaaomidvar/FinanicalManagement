/* مخزن بودجه دسته‌های هزینه — اندپوینت‌های REST بک‌اندِ اختصاصی (/category-budgets).
   پیشوندِ «Supabase» در نامِ کلاس میراثی است؛ مخزن اکنون REST-محور است و از
   RestClient استفاده می‌کند (توکن خودکار از هدر). دستهٔ بودجه در مسیرِ حذف می‌آید و
   چون ممکن است فارسی باشد encode می‌شود. */

import type {
  CategoryBudget,
  CategoryBudgetRepository,
} from "@/domain/category/category-budget.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import { mapCategoryBudget, type CategoryBudgetRow } from "./mappers";

export class SupabaseCategoryBudgetRepository
  implements CategoryBudgetRepository
{
  constructor(private readonly client: RestClient) {}

  async list(): Promise<CategoryBudget[]> {
    const rows =
      await this.client.get<CategoryBudgetRow[]>("/category-budgets");
    return (rows ?? []).map(mapCategoryBudget);
  }

  async set(category: string, amount: number): Promise<CategoryBudget> {
    const row = await this.client.post<CategoryBudgetRow>("/category-budgets", {
      category,
      amount,
    });
    return mapCategoryBudget(row);
  }

  async remove(category: string): Promise<void> {
    await this.client.del<void>(
      `/category-budgets/${encodeURIComponent(category)}`,
    );
  }
}
