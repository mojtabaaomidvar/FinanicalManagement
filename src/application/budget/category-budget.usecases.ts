/* Use-caseهای بودجه دسته‌های هزینه */

import type {
  CategoryBudget,
  CategoryBudgetRepository,
  CategoryBudgetWriteOptions,
} from "@/domain/category/category-budget.types";
import { AppError } from "@/shared/lib/appError";
import { MAX_CATEGORY_BUDGET, MAX_MONTHLY_BUDGET } from "@/domain/budget/budget.rules";

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
  } & CategoryBudgetWriteOptions): Promise<CategoryBudget> {
    if (!input.category) {
      throw new AppError("INVALID_TX", "دسته را انتخاب کنید");
    }
    if (!Number.isFinite(input.amount) || Math.round(input.amount) <= 0 || input.amount > MAX_CATEGORY_BUDGET) {
      throw new AppError("INVALID_TX", "مبلغ بودجه باید مثبت و در محدودهٔ مجاز باشد");
    }
    const { category, amount, ...options } = input;
    for (const value of Object.values(options)) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new AppError("INVALID_TX", "مقادیر بودجه معتبر نیستند");
      }
    }
    if (options.monthlyCap !== undefined && options.monthlyCap > MAX_MONTHLY_BUDGET) {
      throw new AppError("INVALID_TX", "سقف بودجه از محدودهٔ مجاز بیشتر است");
    }
    return Object.keys(options).length
      ? this.repo.set(category, Math.round(amount), options)
      : this.repo.set(category, Math.round(amount));
  }
}

export class DeleteCategoryBudgetUseCase {
  constructor(private readonly repo: CategoryBudgetRepository) {}
  execute(category: string, expectedAmount?: number): Promise<void> {
    return expectedAmount === undefined ? this.repo.remove(category) : this.repo.remove(category, expectedAmount);
  }
}
