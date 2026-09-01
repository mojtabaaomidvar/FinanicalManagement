/* ترکیب دسته‌های ثابت و سفارشی → resolver نمایش */

import type { Category } from "./category.catalog";
import { categoryById, CUSTOM_CATEGORY_ICON } from "./category.catalog";
import type { CustomCategory } from "./custom-category.types";

/** تابعی که id دسته را به Category تبدیل می‌کند (سفارشی یا ثابت) */
export type CategoryResolver = (id: string) => Category;

export function buildCategoryResolver(
  customs: CustomCategory[],
): CategoryResolver {
  const map = new Map<string, Category>(
    customs.map((c) => [
      c.id,
      { id: c.id, name: c.name, icon: CUSTOM_CATEGORY_ICON, type: c.type },
    ]),
  );
  return (id: string) => map.get(id) ?? categoryById(id);
}
