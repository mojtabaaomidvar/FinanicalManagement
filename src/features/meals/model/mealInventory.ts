import type { InventoryItem } from "@/domain/shopping/shopping.types";
import type { MealIngredient } from "@/domain/meal/meal.types";
import { exactInventorySuggestion, inventoryCatalogId } from "@/domain/inventory/inventory.catalog";

export type MealInventoryStatus = "available" | "missing" | "unresolved";

export interface MealInventoryCheck {
  ingredient: MealIngredient;
  catalogId: string | null;
  status: MealInventoryStatus;
}

/**
 * Availability deliberately answers only whether the catalog item exists in
 * the household inventory. Recipe quantities are intentionally unknown in the
 * reviewed source and must not be guessed.
 */
export function checkMealIngredient(
  ingredient: MealIngredient,
  inventory: readonly InventoryItem[],
): MealInventoryCheck {
  const catalogId = ingredient.catalogId
    ?? (exactInventorySuggestion(ingredient.title)
      ? inventoryCatalogId(exactInventorySuggestion(ingredient.title)!) : null);
  if (!catalogId) return { ingredient, catalogId: null, status: "unresolved" };
  const matching = inventory.filter((item) => (item.catalogId ?? null) === catalogId);
  const exists = ingredient.qty === null ? matching.some(item => item.quantity > 0)
    : matching.filter(item => item.unit === ingredient.unit).reduce((sum, item) => sum + item.quantity, 0) >= ingredient.qty;
  return { ingredient, catalogId, status: exists ? "available" : "missing" };
}

export function checkMealIngredients(
  ingredients: readonly MealIngredient[],
  inventory: readonly InventoryItem[],
): MealInventoryCheck[] {
  return ingredients.map((ingredient) => checkMealIngredient(ingredient, inventory));
}

export function statusText(status: MealInventoryStatus): string {
  if (status === "available") return /* @copy-text meals.inventory.available */ "موجود در انبار";
  if (status === "missing") return /* @copy-text meals.inventory.missing */ "موجود نیست";
  return /* @copy-text meals.inventory.unresolved */ "نیازمند تعیین قلم";
}
