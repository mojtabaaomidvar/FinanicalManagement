import type { DishInput, MealDish, MealEntry, MealIngredient } from "./meal.types";
import { roundQty } from "@/domain/shopping/shopping.rules";

export const MEAL_LIMITS = { dishes: 200, ingredients: 50, importItems: 250, title: 120, unit: 20, qty: 99_999_999 } as const;

const cleanText = (text: string) => text.trim().replace(/\s+/g, " ");

export function cleanIngredient(ingredient: MealIngredient): MealIngredient {
  return { title: cleanText(ingredient.title), qty: ingredient.qty === null ? null : roundQty(ingredient.qty), unit: ingredient.unit ? cleanText(ingredient.unit) || null : null };
}

export function ingredientError(ingredient: MealIngredient): string {
  if (!ingredient.title.trim()) return "نام مادهٔ لازم را بنویسید.";
  if (ingredient.title.trim().length > MEAL_LIMITS.title) return "نام مادهٔ لازم باید حداکثر ۱۲۰ نویسه باشد.";
  if ((ingredient.unit?.trim().length ?? 0) > MEAL_LIMITS.unit) return "واحد باید حداکثر ۲۰ نویسه باشد.";
  if (ingredient.qty !== null && (!Number.isFinite(ingredient.qty) || roundQty(ingredient.qty) <= 0 || ingredient.qty > MEAL_LIMITS.qty)) return "مقدار هر ماده باید بیشتر از صفر و حداکثر ۹۹٬۹۹۹٬۹۹۹ باشد.";
  return "";
}

export function dishError(input: DishInput): string {
  if (!input.title.trim()) return "نام غذا را بنویسید.";
  if (input.title.trim().length > MEAL_LIMITS.title) return "نام غذا باید حداکثر ۱۲۰ نویسه باشد.";
  if (input.ingredients.length > MEAL_LIMITS.ingredients) return "برای هر غذا حداکثر ۵۰ ماده ثبت کنید.";
  for (const row of input.ingredients) {
    const error = ingredientError(row);
    if (error) return error;
  }
  return "";
}

export interface WeeklyIngredient extends MealIngredient {
  key: string;
  conflictingUnit: boolean;
}

/** Titles and units use the same whitespace normalization as shopping imports. */
export function weeklyIngredients(entries: MealEntry[], dishes: MealDish[]): WeeklyIngredient[] {
  const catalog = new Map(dishes.map((dish) => [dish.id, dish]));
  const combined = new Map<string, MealIngredient>();
  for (const entry of entries) {
    for (const raw of catalog.get(entry.dishId)?.ingredients ?? []) {
      const row = cleanIngredient(raw);
      const key = JSON.stringify([row.title, row.unit]);
      const existing = combined.get(key);
      combined.set(key, { ...row, qty: row.qty === null || existing?.qty === null ? null : roundQty((existing?.qty ?? 0) + row.qty) });
    }
  }
  const units = new Map<string, Set<string | null>>();
  for (const row of combined.values()) {
    const variants = units.get(row.title) ?? new Set<string | null>();
    variants.add(row.unit); units.set(row.title, variants);
  }
  return Array.from(combined, ([key, row]) => ({ ...row, key, conflictingUnit: (units.get(row.title)?.size ?? 0) > 1 }));
}

export function importError(items: MealIngredient[]): string {
  if (!items.length) return "حداقل یک ماده را انتخاب کنید.";
  if (items.length > MEAL_LIMITS.importItems) return "در هر بار حداکثر ۲۵۰ ماده را به خرید اضافه کنید.";
  const units = new Map<string, string | null>();
  const quantities = new Map<string, number>();
  for (const raw of items) {
    if (raw.qty === null) return "برای افزودن به خرید، مقدار مواد انتخاب‌شده را خودتان وارد کنید.";
    const error = ingredientError(raw);
    if (error) return error;
    const row = cleanIngredient(raw);
    if (units.has(row.title) && units.get(row.title) !== row.unit) return `برای «${row.title}» فقط یک واحد انتخاب کنید یا واحدها را دستی یکسان کنید.`;
    units.set(row.title, row.unit);
    const qty = roundQty((quantities.get(row.title) ?? 0) + row.qty!);
    const combinedError = ingredientError({ ...row, qty });
    if (combinedError) return combinedError;
    quantities.set(row.title, qty);
  }
  return "";
}
