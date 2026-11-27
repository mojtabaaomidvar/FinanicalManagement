import type { MealRepository } from "@/domain/meal/meal.repository";
import type { DishInput, MealDish, MealEntry, MealEntryInput, MealIngredient, MealPlan, MealShoppingResult } from "@/domain/meal/meal.types";
import type { MealIngredientCheck, MealSelectionInput, MealSelectionResult } from "@/domain/meal/meal.types";
import type { OfflineScope } from "@/domain/shopping/offline.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

type IngredientRow = Omit<MealIngredient, "qty" | "catalogId"> & { qty: string | number | null; catalog_id?: string | null };
type DishRow = {
  id: string; title: string; ingredients: IngredientRow[]; created_by: string | null;
  revision: number; created_at: string; updated_at: string; can_edit: boolean; can_delete: boolean;
};
type EntryRow = {
  id: string; date: string; meal_type: MealEntry["mealType"]; dish_id: string; created_by: string | null;
  revision: number; created_at: string; updated_at: string; can_edit: boolean; can_delete: boolean;
};
type ImportRow = {
  operation_id: string; list_id: string; replayed: boolean;
  added: Array<IngredientRow & { id: string }>; skipped: Array<{ id: string; title: string }>;
  added_count: number; skipped_count: number;
};

const noNetwork = () => typeof navigator !== "undefined" && navigator.onLine === false;
const requiresConnection = () => new AppError("NETWORK", "برنامهٔ غذایی به اتصال اینترنت نیاز دارد.");
const changedSession = () => new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
const sameScope = (left: OfflineScope | null, right: OfflineScope | null) => Boolean(left && right
  && left.familyId === right.familyId && left.memberId === right.memberId);

function mapIngredient(row: IngredientRow): MealIngredient {
  return { title: row.title, ...(row.catalog_id !== undefined ? { catalogId: row.catalog_id } : {}), qty: row.qty === null ? null : Number(row.qty), unit: row.unit ?? null };
}
const ingredientBody = (row: MealIngredient) => ({ title: row.title, qty: row.qty, unit: row.unit,
  ...(row.catalogId ? { catalog_id: row.catalogId } : {}) });
const dishBody = (input: DishInput) => ({ title: input.title, ingredients: input.ingredients.map(ingredientBody) });
function mapDish(row: DishRow): MealDish {
  return { id: row.id, title: row.title, ingredients: row.ingredients.map(mapIngredient), createdBy: row.created_by,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    canEdit: row.can_edit === true, canDelete: row.can_delete === true };
}
function mapEntry(row: EntryRow): MealEntry {
  return { id: row.id, date: row.date, mealType: row.meal_type, dishId: row.dish_id, createdBy: row.created_by,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    canEdit: row.can_edit === true, canDelete: row.can_delete === true };
}

/** Meals stay online; only shopping's existing engine handles shopping synchronization. */
export class RestMealRepository implements MealRepository {
  constructor(private readonly client: RestClient, private readonly shoppingOffline: ShoppingOfflineEngine,
    private readonly tokenProvider: TokenProvider) {}

  private async options(): Promise<ReqOpts> {
    if (noNetwork()) throw requiresConnection();
    // Invoke before any other async preparation so this request cannot inherit a later account.
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw changedSession();
    return { bearer, cache: "no-store" };
  }

  async listDishes(): Promise<MealDish[]> {
    return (await this.client.get<DishRow[]>("/meals/dishes", await this.options())).map(mapDish);
  }
  async addDish(input: DishInput): Promise<MealDish> {
    return mapDish(await this.client.post<DishRow>("/meals/dishes", dishBody(input), await this.options()));
  }
  async updateDish(id: string, input: DishInput, expectedRevision: number): Promise<MealDish> {
    return mapDish(await this.client.patch<DishRow>(`/meals/dishes/${encodeURIComponent(id)}`,
      { ...dishBody(input), base_revision: expectedRevision }, await this.options()));
  }
  async deleteDish(id: string, expectedRevision: number): Promise<void> {
    await this.client.del(`/meals/dishes/${encodeURIComponent(id)}?base_revision=${expectedRevision}`, await this.options());
  }
  async getPlan(weekStart: string): Promise<MealPlan> {
    const row = await this.client.get<{ week_start: string; entries: EntryRow[] }>(
      `/meals/plan?week_start=${encodeURIComponent(weekStart)}`, await this.options());
    return { weekStart: row.week_start, entries: row.entries.map(mapEntry) };
  }
  async addEntry(input: MealEntryInput): Promise<MealEntry> {
    return mapEntry(await this.client.post<EntryRow>("/meals/plan",
      { date: input.date, meal_type: input.mealType, dish_id: input.dishId }, await this.options()));
  }
  async updateEntry(id: string, dishId: string, expectedRevision: number): Promise<MealEntry> {
    return mapEntry(await this.client.patch<EntryRow>(`/meals/plan/${encodeURIComponent(id)}`,
      { dish_id: dishId, base_revision: expectedRevision }, await this.options()));
  }
  async deleteEntry(id: string, expectedRevision: number): Promise<void> {
    await this.client.del(`/meals/plan/${encodeURIComponent(id)}?base_revision=${expectedRevision}`, await this.options());
  }
  async checkIngredients(ingredients: MealIngredient[]): Promise<MealIngredientCheck[]> {
    const checks = await this.client.post<Array<{ key: string; ingredient: IngredientRow; status: MealIngredientCheck["status"] }>>(
      "/meals/ingredients/check", { ingredients: ingredients.map(ingredientBody) }, await this.options());
    return checks.map(row => ({ ...row, ingredient: mapIngredient(row.ingredient) }));
  }
  async confirmSelection(input: MealSelectionInput): Promise<MealSelectionResult> {
    input = structuredClone(input);
    const options = await this.options();
    if (input.decisions.some(row => row.action === "shopping")) {
      const initial = await this.shoppingOffline.readState();
      if (!initial.scope) throw changedSession();
      if (initial.offline) throw requiresConnection();
      const synced = await this.shoppingOffline.refresh();
      if (!sameScope(initial.scope, synced.scope) || await this.tokenProvider.getToken() !== options.bearer) throw changedSession();
      if (synced.offline || noNetwork()) throw requiresConnection();
      if (synced.pending.length) throw new AppError("CONFLICT", "ابتدا تغییرهای خرید این دستگاه باید ارسال یا بررسی شوند.");
      const latest = await this.shoppingOffline.readState();
      if (!sameScope(initial.scope, latest.scope) || await this.tokenProvider.getToken() !== options.bearer) throw changedSession();
      if (latest.pending.length) throw new AppError("CONFLICT", "ابتدا تغییرهای خرید این دستگاه باید ارسال یا بررسی شوند.");
      if (latest.offline || noNetwork()) throw requiresConnection();
    }
    const row = await this.client.post<{ entry: EntryRow; dish: DishRow; replayed: boolean; added_count: number; skipped_count: number }>(
      "/meals/plan/confirm", { operation_id: input.operationId, date: input.date, meal_type: input.mealType,
        dish_id: input.dishId, dish_revision: input.dishRevision, dish: input.dish ? dishBody(input.dish) : undefined,
        entry_id: input.entryId, base_revision: input.baseRevision, list_id: input.listId, decisions: input.decisions }, options);
    try {
      if (await this.tokenProvider.getToken() === options.bearer) await this.shoppingOffline.refresh();
    } catch { /* The committed meal and shopping receipt remain successful. */ }
    return { entry: mapEntry(row.entry), dish: mapDish(row.dish), replayed: row.replayed,
      addedCount: row.added_count, skippedCount: row.skipped_count };
  }
  async addIngredientsToShopping(listId: string, ingredients: MealIngredient[], operationId: string): Promise<MealShoppingResult> {
    if (noNetwork()) throw requiresConnection();
    // Preserve the submitted gesture while synchronization and identity checks run.
    const items = ingredients.map((row) => ({ title: row.title, qty: row.qty, unit: row.unit }));
    // Start both captures at invocation; synchronization must never replace this bearer.
    const tokenPromise = this.tokenProvider.getToken();
    const scopePromise = this.shoppingOffline.readState();
    const [bearer, initial] = await Promise.all([tokenPromise, scopePromise]);
    if (!bearer || !initial.scope) throw changedSession();
    const scope = initial.scope;
    const stillCurrent = async () => {
      const [token, state] = await Promise.all([this.tokenProvider.getToken(), this.shoppingOffline.readState()]);
      return token === bearer && sameScope(scope, state.scope);
    };
    if (!await stillCurrent()) throw changedSession();
    if (initial.offline) throw requiresConnection();
    const synced = await this.shoppingOffline.refresh();
    if (!await stillCurrent() || !sameScope(scope, synced.scope)) throw changedSession();
    if (noNetwork() || synced.offline) throw requiresConnection();
    if (synced.pending.length) throw new AppError("CONFLICT", "ابتدا تغییرهای خرید این دستگاه باید ارسال یا بررسی شوند.");
    if (!await stillCurrent()) throw changedSession();
    const latest = await this.shoppingOffline.readState();
    if (!sameScope(scope, latest.scope)) throw changedSession();
    if (latest.offline || noNetwork()) throw requiresConnection();
    if (latest.pending.length) throw new AppError("CONFLICT", "ابتدا تغییرهای خرید این دستگاه باید ارسال یا بررسی شوند.");
    const row = await this.client.post<ImportRow>(`/shopping/lists/${encodeURIComponent(listId)}/ensure-missing`,
      { operation_id: operationId, items }, { bearer, cache: "no-store" });
    // The server has committed. A refresh failure must not turn it into a failed import.
    try {
      if (await stillCurrent()) await this.shoppingOffline.refresh();
    } catch { /* The next regular refresh can catch up; this import has committed. */ }
    return { operationId: row.operation_id, listId: row.list_id, replayed: row.replayed,
      added: row.added.map((item) => ({ id: item.id, ...mapIngredient(item) })), skipped: row.skipped,
      addedCount: row.added_count, skippedCount: row.skipped_count };
  }
}
