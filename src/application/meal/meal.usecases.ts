import type { MealRepository } from "@/domain/meal/meal.repository";
import type { DishInput, MealIngredient } from "@/domain/meal/meal.types";
import type { MealEntryInput } from "@/domain/meal/meal.types";
import type { MealSelectionInput } from "@/domain/meal/meal.types";

export class CheckMealIngredientsUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(ingredients: MealIngredient[]) { return this.repo.checkIngredients(ingredients); }
}
export class ConfirmMealSelectionUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(input: MealSelectionInput) { return this.repo.confirmSelection(input); }
}

export class ListDishesUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute() { return this.repo.listDishes(); }
}
export class AddDishUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(input: DishInput) { return this.repo.addDish(input); }
}
export class UpdateDishUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(id: string, input: DishInput, expectedRevision: number) { return this.repo.updateDish(id, input, expectedRevision); }
}
export class DeleteDishUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(id: string, expectedRevision: number) { return this.repo.deleteDish(id, expectedRevision); }
}
export class GetMealPlanUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(weekStart: string) { return this.repo.getPlan(weekStart); }
}
export class AddMealEntryUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(input: MealEntryInput) { return this.repo.addEntry(input); }
}
export class UpdateMealEntryUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(id: string, dishId: string, expectedRevision: number) { return this.repo.updateEntry(id, dishId, expectedRevision); }
}
export class DeleteMealEntryUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(id: string, expectedRevision: number) { return this.repo.deleteEntry(id, expectedRevision); }
}
export class AddMealIngredientsToShoppingUseCase {
  constructor(private readonly repo: MealRepository) {}
  execute(listId: string, ingredients: MealIngredient[], operationId: string) {
    return this.repo.addIngredientsToShopping(listId, ingredients, operationId);
  }
}
