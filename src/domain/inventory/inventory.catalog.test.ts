import { describe, expect, it } from "vitest";
import catalog from "./inventory.catalog.json";
import { findInventorySuggestions, inventoryCategory, INVENTORY_CATALOG_SECTIONS } from "./inventory.catalog";

describe("household inventory suggestions", () => {
  it("carries the subgroup and recognizes exact legacy names and aliases without guessing", () => {
    expect(findInventorySuggestions("چسب تفلون", null, [])[0]?.group).toBe("plumbing");
    expect(inventoryCategory({ title: "تُخم مرغ" })).toBe("refrigerated");
    expect(inventoryCategory({ title: "نام شخصی", category: "cleaning" })).toBe("cleaning");
    expect(inventoryCategory({ title: "تخم" })).toBeNull();
    expect(inventoryCategory({ title: "نام شخصی" })).toBeNull();
  });
  it("finds common names, alternate spellings and mixed-script part numbers", () => {
    const first = (query: string) => findInventorySuggestions(query, null, [])[0]?.title;
    expect(first("تُخم مرغ")).toBe("تخم‌مرغ");
    expect(first("چسب تفلون")).toBe("نوار تفلون");
    expect(first("وایتكس")).toBe("سفیدکننده");
    expect(first("هود فيلتر")).toBe("فیلتر هود");
    expect(first("۹v")).toBe("باتری کتابی ۹ ولت");
    expect(first("wd40")).toBe("اسپری روان‌کننده");
    expect(first("AA")).toBe("باتری قلمی");
  });

  it("respects the selected group even when a query matches outside it", () => {
    const fresh = findInventorySuggestions("اسفناج", "vegetables", []);
    const frozen = findInventorySuggestions("اسفناج", "frozen", []);
    expect(fresh.map(item => item.title)).toEqual(["اسفناج تازه"]);
    expect(frozen.map(item => item.title)).toEqual(["اسفناج منجمد"]);
    expect(findInventorySuggestions("اسفناج", "electrical", [])).toEqual([]);
  });

  it("searches from the first letter and limits matches to an open category", () => {
    const fresh = findInventorySuggestions("گ", INVENTORY_CATALOG_SECTIONS.fresh, []);
    expect(fresh.map(item => item.title)).toContain("گوجه‌فرنگی");
    expect(fresh.map(item => item.title)).toContain("گلابی");
    expect(fresh.map(item => item.title)).not.toContain("گرد غوره");
    expect(findInventorySuggestions("گوجه", null, [])[0]?.title).toBe("گوجه‌فرنگی");
    expect(findInventorySuggestions("گوجه ف", null, [])[0]?.title).toBe("گوجه‌فرنگی");
    expect(findInventorySuggestions("؟", null, [])).toEqual([]);
  });

  it("makes every catalog group reachable in exactly one category box", () => {
    expect(Object.values(INVENTORY_CATALOG_SECTIONS).flat().sort()).toEqual(Object.keys(catalog).sort());
  });

  it("hides an already tracked title without hiding other sizes or changing saved stock", () => {
    const stock = [{ title: "كيسه زباله", unit: "بسته", quantity: 4 }];
    const suggestions = findInventorySuggestions("کیسه زباله", "disposables", stock);
    expect(suggestions.map(item => item.title)).not.toContain("کیسهٔ زباله");
    expect(suggestions.map(item => item.title)).toContain("کیسهٔ زبالهٔ بزرگ");
    expect(stock[0]).toEqual({ title: "كيسه زباله", unit: "بسته", quantity: 4 });
  });

  it("keeps the whole catalog reachable with names and units the add form can save", () => {
    const rows = Object.values(catalog).flat();
    const suggestions = findInventorySuggestions("", null, []);
    expect(suggestions).toHaveLength(rows.length);
    for (const item of rows) {
      expect(item.title).toBe(item.title.trim());
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.title.length).toBeLessThanOrEqual(120);
      expect(item.unit).toBe(item.unit.trim());
      expect(item.unit.length).toBeGreaterThan(0);
      expect(item.unit.length).toBeLessThanOrEqual(20);
    }
    // Hiding one exact title must remove just one result (including after Persian normalization).
    const [first, ...rest] = suggestions;
    expect(findInventorySuggestions("", null, [first])).toEqual(rest);
    expect(new Set(rows.map(item => item.title)).size).toBe(rows.length);
  });
});
