export type MealType = "breakfast" | "lunch" | "dinner";

export interface MealIngredient {
  title: string;
  qty: number;
  unit: string | null;
}

export interface MealDish {
  id: string;
  title: string;
  ingredients: MealIngredient[];
  createdBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface DishInput {
  title: string;
  ingredients: MealIngredient[];
}

export interface MealEntry {
  id: string;
  /** Gregorian calendar day; the interface displays Jalali dates. */
  date: string;
  mealType: MealType;
  dishId: string;
  createdBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface MealEntryInput {
  date: string;
  mealType: MealType;
  dishId: string;
}

export interface MealPlan {
  weekStart: string;
  entries: MealEntry[];
}

export interface MealShoppingResult {
  operationId: string;
  listId: string;
  replayed: boolean;
  added: Array<MealIngredient & { id: string }>;
  skipped: Array<{ id: string; title: string }>;
  addedCount: number;
  skippedCount: number;
}
