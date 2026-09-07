/* Use-caseهای دسته‌های سفارشی */

import type { CustomCategoryRepository } from "@/domain/category/custom-category.types";
import type { CustomCategory } from "@/domain/category/custom-category.types";
import type { TxType } from "@/domain/transaction/transaction.types";
import { AppError } from "@/shared/lib/appError";

export class ListCustomCategoriesUseCase {
  constructor(private readonly repo: CustomCategoryRepository) {}
  execute(): Promise<CustomCategory[]> {
    return this.repo.list();
  }
}

export class AddCustomCategoryUseCase {
  constructor(private readonly repo: CustomCategoryRepository) {}
  async execute(type: TxType, name: string): Promise<CustomCategory> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 30) {
      throw new AppError("INVALID_TX", "نام دسته باید ۱ تا ۳۰ کاراکتر باشد");
    }
    return this.repo.add(type, trimmed);
  }
}

/** حذف دسته سفارشی — سرور اجازه نمی‌دهد دسته‌ای که در تراکنشی به‌کار
    رفته حذف شود (CATEGORY_IN_USE) */
export class DeleteCustomCategoryUseCase {
  constructor(private readonly repo: CustomCategoryRepository) {}
  execute(id: string): Promise<void> {
    if (!id) {
      throw new AppError("NOT_FOUND", "دسته یافت نشد");
    }
    return this.repo.remove(id);
  }
}
