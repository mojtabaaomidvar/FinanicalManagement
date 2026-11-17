import { describe, expect, it } from "vitest";
import type { MealDish, MealEntry, MealIngredient } from "./meal.types";
import { cleanIngredient, dishError, importError, ingredientError, MEAL_LIMITS, weeklyIngredients } from "./meal.rules";

const ingredient = (qty = 1, unit: string | null = "پیمانه"): MealIngredient => ({ title: "برنج", qty, unit });
const dish = (id: string, ingredients: MealIngredient[]): MealDish => ({
  id, title: id, ingredients, createdBy: "member", revision: 1,
  createdAt: "2026-11-14T08:00:00Z", updatedAt: "2026-11-14T08:00:00Z",
  canEdit: true, canDelete: true,
});
const entry = (id: string, dishId: string): MealEntry => ({
  id, dishId, date: "2026-11-14", mealType: "lunch", createdBy: "member", revision: 1,
  createdAt: "2026-11-14T08:00:00Z", updatedAt: "2026-11-14T08:00:00Z",
  canEdit: true, canDelete: true,
});

describe("selected meal ingredient totals", () => {
  it("counts each selected use of a dish and combines matching ingredients with decimal rounding", () => {
    const dishes = [dish("rice", [ingredient(1.005)]), dish("lentils", [ingredient(0.5), { title: "عدس", qty: 0.25, unit: "پیمانه" }])];
    const rows = weeklyIngredients([entry("lunch", "rice"), entry("dinner", "rice"), entry("next", "lentils")], dishes);
    expect(rows.map(({ title, qty, unit, conflictingUnit }) => ({ title, qty, unit, conflictingUnit }))).toEqual([
      { title: "برنج", qty: 2.52, unit: "پیمانه", conflictingUnit: false },
      { title: "عدس", qty: 0.25, unit: "پیمانه", conflictingUnit: false },
    ]);
    expect(dishes[0].ingredients[0].qty).toBe(1.005);
  });

  it("keeps incompatible units separate and flags every variant for manual choice", () => {
    const rows = weeklyIngredients([entry("one", "one"), entry("two", "two"), entry("unknown", "missing")], [
      dish("one", [ingredient(1, "پیمانه")]), dish("two", [ingredient(500, "گرم")]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.qty)).toEqual([1, 500]);
    expect(rows.every((row) => row.conflictingUnit)).toBe(true);
    expect(importError(rows)).toContain("فقط یک واحد");
    expect(importError([rows[0]])).toBe("");
    expect(importError(rows.map((row) => ({ ...row, unit: "گرم" })))).toBe("");
  });

  it("matches the server's whitespace normalization so one ingredient cannot bypass unit checks", () => {
    const rows = weeklyIngredients([entry("one", "one"), entry("two", "two")], [
      dish("one", [{ title: " رب  گوجه ", qty: 1, unit: "قاشق  غذاخوری" }]),
      dish("two", [{ title: "رب گوجه", qty: 2, unit: " قاشق غذاخوری " }]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "رب گوجه", qty: 3, unit: "قاشق غذاخوری", conflictingUnit: false });
    expect(importError([{ title: " رب  گوجه ", qty: 1, unit: "عدد" }, { title: "رب گوجه", qty: 1, unit: "گرم" }])).toContain("فقط یک واحد");
  });

  it("treats whitespace-only units as absent and gives collision-safe keys", () => {
    expect(cleanIngredient({ title: " برنج ", qty: 1.005, unit: " " })).toEqual({ title: "برنج", qty: 1.01, unit: null });
    const rows = weeklyIngredients([entry("one", "one")], [dish("one", [
      { title: "a|b", qty: 1, unit: "c" }, { title: "a", qty: 1, unit: "b|c" },
    ])]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
  });
});

describe("meal form validation", () => {
  it.each([0, -1, NaN, Infinity, 0.004, 1e-8, MEAL_LIMITS.qty + 1])("rejects quantity %s before submitting a zero or invalid amount", (qty) => {
    expect(ingredientError(ingredient(qty))).not.toBe("");
  });

  it("accepts the smallest rounded quantity and the exact upper bound", () => {
    expect(ingredientError(ingredient(0.005))).toBe("");
    expect(cleanIngredient(ingredient(0.005)).qty).toBe(0.01);
    expect(ingredientError(ingredient(MEAL_LIMITS.qty))).toBe("");
  });

  it("rejects empty names, too-long units and an overflowing ingredient count", () => {
    expect(dishError({ title: " ", ingredients: [] })).not.toBe("");
    expect(dishError({ title: "غذا", ingredients: Array.from({ length: MEAL_LIMITS.ingredients + 1 }, () => ingredient()) })).not.toBe("");
    expect(ingredientError({ ...ingredient(), title: " " })).not.toBe("");
    expect(ingredientError(ingredient(1, "x".repeat(MEAL_LIMITS.unit + 1)))).not.toBe("");
    expect(dishError({ title: "غذا", ingredients: [] })).toBe("");
  });

  it("requires a bounded import selection and rejects summed quantities exceeding the server limit", () => {
    expect(importError([])).not.toBe("");
    expect(importError(Array.from({ length: MEAL_LIMITS.importItems + 1 }, () => ingredient()))).not.toBe("");
    expect(importError([ingredient(MEAL_LIMITS.qty), ingredient(0.01)])).not.toBe("");
  });
});
