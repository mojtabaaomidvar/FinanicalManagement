export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealIngredient {
  title: string;
  /** Stable reviewed inventory identity when the ingredient is catalogued. */
  catalogId?: string | null;
  /** Null means no recipe amount was supplied; never a synthetic quantity of one. */
  qty: number | null;
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

export interface MealIngredientCheck {
  key: string;
  ingredient: MealIngredient;
  status: "available" | "missing" | "unresolved";
}

export interface MealSelectionInput {
  operationId: string;
  date: string;
  mealType: MealType;
  dishId?: string;
  dishRevision?: number;
  dish?: DishInput;
  entryId?: string;
  baseRevision?: number;
  listId?: string;
  decisions: Array<{ key: string; action: "shopping" | "available"; qty: number | null; unit: string | null }>;
}

export interface MealSelectionResult {
  entry: MealEntry;
  dish: MealDish;
  replayed: boolean;
  addedCount: number;
  skippedCount: number;
}
