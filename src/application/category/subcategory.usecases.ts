/* Use-caseهای زیردسته */

import type { SubcategoryRepository } from "@/domain/category/subcategory.types";
import type { Subcategory } from "@/domain/category/subcategory.types";
import { AppError } from "@/shared/lib/appError";

export class ListSubcategoriesUseCase {
  constructor(private readonly repo: SubcategoryRepository) {}
  execute(): Promise<Subcategory[]> {
    return this.repo.list();
  }
}

export class AddSubcategoryUseCase {
  constructor(private readonly repo: SubcategoryRepository) {}
  async execute(category: string, name: string): Promise<Subcategory> {
    const trimmed = name.trim();
    if (!category) throw new AppError("INVALID_TX", "دسته معتبر نیست");
    if (!trimmed || trimmed.length > 30) {
      throw new AppError("INVALID_TX", "نام زیردسته باید ۱ تا ۳۰ کاراکتر باشد");
    }
    return this.repo.add(category, trimmed);
  }
}

export class DeleteSubcategoryUseCase {
  constructor(private readonly repo: SubcategoryRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
