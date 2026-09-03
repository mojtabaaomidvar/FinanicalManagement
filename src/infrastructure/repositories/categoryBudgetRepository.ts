/* مخزن بودجه دسته‌های هزینه */

import type {
  CategoryBudget,
  CategoryBudgetRepository,
} from "@/domain/category/category-budget.types";
import { rpc } from "@/infrastructure/api/httpClient";
import { mapCategoryBudget, type CategoryBudgetRow } from "./mappers";
import type { TokenProvider } from "./sessionRepository";

export class SupabaseCategoryBudgetRepository
  implements CategoryBudgetRepository
{
  constructor(private readonly tokenProvider: TokenProvider) {}

  private async tok(): Promise<string> {
    const t = await this.tokenProvider.getToken();
    if (!t) throw new Error("NO_SESSION");
    return t;
  }

  async list(): Promise<CategoryBudget[]> {
    const rows = await rpc<CategoryBudgetRow[]>("list_category_budgets", {
      p_token: await this.tok(),
    });
    return (rows ?? []).map(mapCategoryBudget);
  }

  async set(category: string, amount: number): Promise<CategoryBudget> {
    const row = await rpc<CategoryBudgetRow>("set_category_budget", {
      p_token: await this.tok(),
      p_category: category,
      p_amount: amount,
    });
    return mapCategoryBudget(row);
  }

  async remove(category: string): Promise<void> {
    await rpc("delete_category_budget", {
      p_token: await this.tok(),
      p_category: category,
    });
  }
}
