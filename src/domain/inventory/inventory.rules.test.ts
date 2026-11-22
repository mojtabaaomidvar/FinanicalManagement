import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@/domain/shopping/shopping.types";
import { filterInventory, liveInventoryQuantity, parseInventoryQuantity } from "./inventory.rules";

const item = (values: Partial<InventoryItem> = {}): InventoryItem => ({
  id: "stock", title: "برنج", quantity: 1.5, category: "grains", unit: "کیلو", note: null,
  createdBy: null, createdAt: "2026-11-21", updatedAt: "2026-11-21", ...values,
});

describe("inventory quantities", () => {
  it("filters custom stock by its saved category and preserves uncategorized legacy stock", () => {
    const custom = item({ title: "محصول شخصی", category: "cleaning" });
    const legacy = item({ title: "نام قدیمی", category: null });
    expect(filterInventory([custom, legacy, item()], "all", "", ["cleaning"])).toEqual([custom]);
    expect(filterInventory([custom, legacy, item()], "all", "", "uncategorized")).toEqual([legacy]);
  });
  it("preserves invalid input for validation and never turns a negative count into positive stock", () => {
    for (const raw of ["-2", "−۲", "1+2", "نیم کیلو", "1.2.3", "NaN", "100000000", ""]) {
      expect(parseInventoryQuantity(liveInventoryQuantity(raw))).toBeNull();
    }
    expect(parseInventoryQuantity("۰")).toBe(0);
    expect(parseInventoryQuantity("۰", false)).toBeNull();
    expect(parseInventoryQuantity("۰٫۰۰۴", false)).toBeNull();
  });
  it("matches Decimal half-up rounding and Persian/Arabic decimal input", () => {
    expect(parseInventoryQuantity("۱٫۰۰۵")).toBe(1.01);
    expect(parseInventoryQuantity("٠٫٥", false)).toBe(0.5);
    expect(parseInventoryQuantity("۱٬۲۳۴٫۵۰")).toBe(1234.5);
  });
  it("lists empty stock independently of any shortage threshold", () => {
    const empty = item({ quantity: 0, title: "دستمال کاغذی" });
    expect(filterInventory([empty], "empty", "كاغذي")).toEqual([empty]);
  });
});
