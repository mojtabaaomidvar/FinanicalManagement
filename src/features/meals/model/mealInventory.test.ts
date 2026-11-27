import { describe, expect, it } from "vitest";
import { checkMealIngredient, checkMealIngredients } from "./mealInventory";

const inventory = [{ id: "1", title: "برنج", unit: "کیلو", quantity: 2,
  catalogId: "preset:برنج", note: null, category: "grains", createdBy: null,
  createdAt: "", updatedAt: "" }];

describe("meal inventory availability", () => {
  it("uses stable identity and reports unknown recipe amounts only as presence", () => {
    expect(checkMealIngredient({ title: "برنج", catalogId: "preset:برنج", qty: null, unit: null }, inventory).status)
      .toBe("available");
    expect(checkMealIngredient({ title: "برنج", catalogId: "preset:برنج", qty: 999, unit: "کیلو" }, inventory).status)
      .toBe("missing");
  });

  it("does not treat a zero stock row or a different unit as available", () => {
    const ingredient = { title: "برنج", catalogId: "preset:برنج", qty: null, unit: null };
    expect(checkMealIngredient(ingredient, [{ ...inventory[0], quantity: 0 }]).status).toBe("missing");
    expect(checkMealIngredient({ ...ingredient, qty: 2, unit: "کیلو" }, inventory).status).toBe("available");
    expect(checkMealIngredient({ ...ingredient, qty: 2, unit: "گرم" }, inventory).status).toBe("missing");
    expect(checkMealIngredient({ ...ingredient, title: "عنوان نمایشی متفاوت" }, inventory).status).toBe("available");
    expect(checkMealIngredient({ ...ingredient, catalogId: "preset:دیگر" }, inventory).status).toBe("missing");
  });

  it("marks a known catalog item missing without changing the inventory", () => {
    const result = checkMealIngredients([
      { title: "پیاز", catalogId: "preset:پیاز", qty: null, unit: null },
    ], inventory);
    expect(result[0].status).toBe("missing");
    expect(inventory[0].quantity).toBe(2);
  });

  it("does not silently classify an unresolved ingredient", () => {
    expect(checkMealIngredient({ title: "مادهٔ ناشناخته", qty: null, unit: null }, inventory).status)
      .toBe("unresolved");
  });
});
