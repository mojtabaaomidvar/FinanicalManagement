import type { MealIngredient } from "@/domain/meal/meal.types";

export interface LibraryTag { id: string; label: string }
export interface LibraryFood {
  id: string;
  title: string;
  aliases: string[];
  meals: string[];
  categories: string[];
  variantCount: number;
  ingredientPreview: string[];
  detailFile: string;
}
export interface LibraryIndex {
  schemaVersion: number;
  sourceHash: string;
  foodCount: number;
  variantCount: number;
  meals: LibraryTag[];
  categories: LibraryTag[];
  foods: LibraryFood[];
}
export interface LibraryItem {
  id: string;
  kind: "ingredient" | "choice" | "open_choice" | "equipment" | "unresolved";
  required: boolean;
  name?: string;
  label?: string;
  options?: string[];
  allowCustom?: boolean;
}
export interface LibraryVariant { id: string; items: LibraryItem[]; needsReview: boolean }
export interface LibraryDetail { id: string; variants: LibraryVariant[] }
export interface LibrarySelection { included: boolean; name: string }
export type LibrarySelections = Record<string, LibrarySelection>;

export const LIBRARY_PAGE_SIZE = 24;
let indexRequest: Promise<LibraryIndex> | null = null;
const detailRequests = new Map<string, Promise<LibraryDetail[]>>();

export function normalizeFoodSearch(text: string): string {
  return text.normalize("NFKC").replace(/[يى]/g, "ی").replace(/ك/g, "ک")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[\s\u200c\u200d]+/g, "").toLocaleLowerCase("fa");
}

export function filterLibrary(index: LibraryIndex, query: string, meal = "", category = ""): LibraryFood[] {
  const terms = query.trim().split(/\s+/).map(normalizeFoodSearch).filter(Boolean);
  return index.foods.filter(food => (!meal || food.meals.includes(meal)) && (!category || food.categories.includes(category))
    && terms.every(term => [food.title, ...food.aliases].some(title => normalizeFoodSearch(title).includes(term))));
}

export async function loadLibrary(): Promise<LibraryIndex> {
  indexRequest ??= fetch("/meal-library/index.json").then(async response => {
    if (!response.ok) throw new Error("Library unavailable");
    const index: LibraryIndex = await response.json();
    if (index.schemaVersion !== 1 || index.foodCount !== index.foods?.length || !Array.isArray(index.meals) || !Array.isArray(index.categories)) throw new Error("Invalid library index");
    return index;
  }).catch(error => { indexRequest = null; throw error; });
  return indexRequest;
}

export async function loadLibraryDetail(food: LibraryFood): Promise<LibraryDetail> {
  if (!/^details-[a-f0-9]{2}\.json$/.test(food.detailFile)) throw new Error("Invalid library shard");
  if (!detailRequests.has(food.detailFile)) detailRequests.set(food.detailFile,
    fetch("/meal-library/" + food.detailFile).then(async response => {
      if (!response.ok) throw new Error("Library details unavailable");
      const details: LibraryDetail[] = await response.json();
      if (!Array.isArray(details)) throw new Error("Invalid library details");
      return details;
    }).catch(error => { detailRequests.delete(food.detailFile); throw error; }));
  const details = await detailRequests.get(food.detailFile)!;
  const detail = details.find(row => row.id === food.id);
  if (!detail?.variants.length || detail.variants.length !== food.variantCount) throw new Error("Food details missing");
  return detail;
}

export function initialLibrarySelections(variant: LibraryVariant): LibrarySelections {
  return Object.fromEntries(variant.items.filter(item => item.kind !== "equipment")
    .map(item => [item.id, { included: item.required, name: item.kind === "ingredient" ? item.name ?? "" : "" }]));
}

/** Alternatives and unresolved expressions never become an automatic union or shopping item. */
export function selectedLibraryIngredients(variant: LibraryVariant, selections: LibrarySelections): MealIngredient[] | null {
  const result: MealIngredient[] = [];
  for (const item of variant.items) {
    if (item.kind === "equipment" || !selections[item.id]?.included) continue;
    const name = selections[item.id].name.trim();
    if (!name || name.length > 120) return null;
    if (item.kind === "choice" && !item.allowCustom && !item.options?.includes(name)) return null;
    result.push({ title: name, qty: null, unit: null });
  }
  return result;
}
