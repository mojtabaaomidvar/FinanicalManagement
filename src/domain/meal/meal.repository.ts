import type { DishInput, MealDish, MealEntry, MealEntryInput, MealIngredient, MealPlan, MealShoppingResult } from "./meal.types";

export interface MealRepository {
  listDishes(): Promise<MealDish[]>;
  addDish(input: DishInput): Promise<MealDish>;
  updateDish(id: string, input: DishInput, expectedRevision: number): Promise<MealDish>;
  deleteDish(id: string, expectedRevision: number): Promise<void>;
  getPlan(weekStart: string): Promise<MealPlan>;
  addEntry(input: MealEntryInput): Promise<MealEntry>;
  updateEntry(id: string, dishId: string, expectedRevision: number): Promise<MealEntry>;
  deleteEntry(id: string, expectedRevision: number): Promise<void>;
  addIngredientsToShopping(listId: string, ingredients: MealIngredient[], operationId: string): Promise<MealShoppingResult>;
}
