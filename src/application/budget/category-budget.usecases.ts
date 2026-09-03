/* Use-caseهای بودجه دسته‌های هزینه */

import type {
  CategoryBudget,
  CategoryBudgetRepository,
} from "@/domain/category/category-budget.types";
import { AppError } from "@/shared/lib/appError";

export class ListCategoryBudgetsUseCase {
  constructor(private readonly repo: CategoryBudgetRepository) {}
  execute(): Promise<CategoryBudget[]> {
    return this.repo.list();
  }
}

export class SetCategoryBudgetUseCase {
  constructor(private readonly repo: CategoryBudgetRepository) {}
  async execute(input: {
    category: string;
    amount: number;
  }): Promise<CategoryBudget> {
    if (!input.category) {
      throw new AppError("INVALID_TX", "دسته را انتخاب کنید");
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new AppError("INVALID_TX", "مبلغ بودجه باید بزرگ‌تر از صفر باشد");
    }
    return this.repo.set(input.category, Math.round(input.amount));
  }
}

export class DeleteCategoryBudgetUseCase {
  constructor(private readonly repo: CategoryBudgetRepository) {}
  execute(category: string): Promise<void> {
    return this.repo.remove(category);
  }
}
