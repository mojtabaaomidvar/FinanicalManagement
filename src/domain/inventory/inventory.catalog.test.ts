import { describe, expect, it } from "vitest";
import catalog from "./inventory.catalog.json";
import { exactInventorySuggestion, findInventorySuggestions, inventoryCategory, inventoryNameFields,
  mergeInventoryCatalog, INVENTORY_PRESETS, INVENTORY_CATALOG_SECTIONS, type InventorySuggestion } from "./inventory.catalog";
import { INVENTORY_UNIT_OPTIONS } from "./inventory.units";

describe("household inventory suggestions", () => {
  it("uses exact known names and aliases for category and unit without completing a partial word", () => {
    const blank = { title: "", category: "" as const, unit: "", quantity: "۲" };
    expect(inventoryNameFields(blank, "آب")).toMatchObject({ title: "آب", category: "drinks", unit: "بطری", quantity: "۲" });
    expect(inventoryNameFields(blank, "پنیر")).toMatchObject({ category: "refrigerated", unit: "بسته" });
    expect(inventoryNameFields(blank, "تُخم مرغ")).toMatchObject({ category: "refrigerated", unit: "عدد" });
    expect(inventoryNameFields(blank, "تخم")).toEqual({ ...blank, title: "تخم" });
  });

  it("clears automatic defaults for an unknown name but preserves explicitly chosen custom metadata", () => {
    const known = { title: "آب", category: "drinks" as const, unit: "بطری", note: "private" };
    expect(inventoryNameFields(known, "کالای تازه")).toEqual({ title: "کالای تازه", category: "", unit: "", note: "private" });
    const custom = { title: "قلم من", category: "cleaning" as const, unit: "قوطی" };
    expect(inventoryNameFields(custom, "قلم دیگر")).toEqual({ ...custom, title: "قلم دیگر" });
  });

  it("merges published items by normalized name, retaining IDs and the packaged offline baseline", () => {
    const published: InventorySuggestion = { id: "persisted-id", title: "کالای تازه", group: "cleaning", unit: "پاکت" };
    const entries = mergeInventoryCatalog([published]);
    expect(entries).toHaveLength(INVENTORY_PRESETS.length + 1);
    expect(findInventorySuggestions("كالاي تازه", null, [], entries)[0]).toEqual(published);
    expect(exactInventorySuggestion("كالاي تازه", entries)).toEqual(published);
    expect(inventoryCategory({ title: "كالاي تازه" }, entries)).toBe("cleaning");
    expect(mergeInventoryCatalog([published, { ...published, title: "كالاي تازه" }])).toHaveLength(entries.length);
    expect(mergeInventoryCatalog([])).toEqual(INVENTORY_PRESETS);
    expect(INVENTORY_PRESETS.some(item => item.id === published.id)).toBe(false);
  });

  it("does not guess an ambiguous alias or change a title to a shorter search fragment", () => {
    const entries: InventorySuggestion[] = [{ title: "قلم اول", group: "cleaning", unit: "بطری", aliases: ["نام مشترک"] },
      { title: "قلم دوم", group: "cleaning", unit: "قوطی", aliases: ["نام مشترک"] }];
    expect(exactInventorySuggestion("نام مشترک", entries)).toBeNull();
    const egg = exactInventorySuggestion("تخم مرغ");
    expect(egg?.title).toBe("تخم‌مرغ");
    expect(exactInventorySuggestion("تخم")).toBeNull();
    expect(findInventorySuggestions("باقال", null, [])[0]?.title).toContain("باقلا");
  });

  it("offers all existing catalog units plus bottles, cartons and millilitres", () => {
    const values = new Set<string>(INVENTORY_UNIT_OPTIONS.map(option => option.value));
    for (const item of INVENTORY_PRESETS) expect(values.has(item.unit)).toBe(true);
    expect(values.has("بطری") && values.has("پاکت") && values.has("میلی‌لیتر")).toBe(true);
  });
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
