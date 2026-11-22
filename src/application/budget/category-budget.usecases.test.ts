import { describe, expect, it, vi } from "vitest";
import { SetCategoryBudgetUseCase } from "./category-budget.usecases";
import { MAX_CATEGORY_BUDGET } from "@/domain/budget/budget.rules";
import type { CategoryBudgetRepository } from "@/domain/category/category-budget.types";

describe("category budget writes", () => {
  it("sends cap and allocation expectations together in the same write", async () => {
    const set = vi.fn(async (category, amount) => ({ category, amount }));
    const useCase = new SetCategoryBudgetUseCase({ set } as unknown as CategoryBudgetRepository);
    const options = { monthlyCap: 3000, expectedAmount: 1000, expectedMonthlyCap: 2000, expectedBudgetTotal: 1000 };
    await useCase.execute({ category: "food", amount: 3000, ...options });
    expect(set).toHaveBeenCalledExactlyOnceWith("food", 3000, options);
  });
  it("does not send non-finite or negative expectations to the server", async () => {
    const set = vi.fn();
    const useCase = new SetCategoryBudgetUseCase({ set } as unknown as CategoryBudgetRepository);
    await expect(useCase.execute({ category: "food", amount: 1000, monthlyCap: Infinity })).rejects.toThrow();
    await expect(useCase.execute({ category: "food", amount: 1000, expectedBudgetTotal: -1 })).rejects.toThrow();
    expect(set).not.toHaveBeenCalled();
  });
  it("rejects amounts outside the stored contract before calling the repository", async () => {
    const set = vi.fn();
    const useCase = new SetCategoryBudgetUseCase({ set } as unknown as CategoryBudgetRepository);
    for (const amount of [0, -1, 0.1, NaN, Infinity, MAX_CATEGORY_BUDGET + 1]) {
      await expect(useCase.execute({ category: "food", amount })).rejects.toThrow();
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("retains the category and existing whole-unit rounding for a valid write", async () => {
    const set = vi.fn(async (category, amount) => ({ category, amount }));
    const useCase = new SetCategoryBudgetUseCase({ set } as unknown as CategoryBudgetRepository);
    await expect(useCase.execute({ category: "family-custom-id", amount: 1200.5 })).resolves.toEqual({ category: "family-custom-id", amount: 1201 });
    expect(set).toHaveBeenCalledExactlyOnceWith("family-custom-id", 1201);
  });
});
