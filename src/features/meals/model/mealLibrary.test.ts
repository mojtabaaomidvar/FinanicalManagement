import { describe, it, expect, vi, afterEach } from "vitest";
import { filterLibrary, initialLibrarySelections, normalizeFoodSearch, selectedLibraryIngredients } from "./mealLibrary";
import type { LibraryFood, LibraryIndex, LibraryVariant } from "./mealLibrary";

describe("Persian food library", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it("shares public loading requests, clears rejected requests for retry, and prevents arbitrary detail paths", async () => {
    const library = await import("./mealLibrary");
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(library.loadLibrary()).rejects.toThrow("offline");
    const index = { schemaVersion: 1, foodCount: 0, foods: [], meals: [], categories: [] };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(index)));
    const [a, b] = await Promise.all([library.loadLibrary(), library.loadLibrary()]);
    expect(a).toEqual(index); expect(a).toBe(b); expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(library.loadLibraryDetail({ detailFile: "../private.json" } as never)).rejects.toThrow("Invalid library shard");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("loads one whole food from a shared shard and rejects missing or mismatched detail records", async () => {
    const library = await import("./mealLibrary");
    const variants = [{ id: "v", needsReview: false, items: [] }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "one", variants }, { id: "two", variants }])));
    vi.stubGlobal("fetch", fetchMock);
    const food = { id: "one", detailFile: "details-ab.json", variantCount: 1 } as LibraryFood;
    expect((await library.loadLibraryDetail(food)).id).toBe("one");
    expect((await library.loadLibraryDetail({ ...food, id: "two" })).id).toBe("two");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(library.loadLibraryDetail({ ...food, id: "missing" })).rejects.toThrow("Food details missing");
    await expect(library.loadLibraryDetail({ ...food, variantCount: 2 })).rejects.toThrow("Food details missing");
  });
  it("searches Persian/Arabic letters, spacing, aliases, and all source meal tags", () => {
    expect(normalizeFoodSearch("كيكِ سیب‌زمینی")).toBe(normalizeFoodSearch("کیک سیب زمینی"));
    const index = { foods: [
      { id: "one", title: "عدس پلو", aliases: ["عدس‌پلو"], meals: ["lunch", "dinner"], categories: ["rice"] },
      { id: "two", title: "کیک", aliases: [], meals: ["dessert"], categories: ["cake"] },
    ] } as LibraryIndex;
    expect(filterLibrary(index, "عدس‌پلو", "dinner").map(row => row.id)).toEqual(["one"]);
    expect(filterLibrary(index, "كيك", "dessert", "cake").map(row => row.id)).toEqual(["two"]);
    expect(filterLibrary(index, "", "lunch", "cake")).toEqual([]);
    expect(filterLibrary(index, "نام ناموجود")).toEqual([]);
  });

  it("requires individual choices and excludes equipment and unselected optional ingredients", () => {
    const variant: LibraryVariant = { id: "one", needsReview: true, items: [
      { id: "rice", kind: "ingredient", name: "برنج", required: true },
      { id: "or", kind: "choice", label: "مرغ یا گوشت", options: ["مرغ", "گوشت"], required: true },
      { id: "herb", kind: "open_choice", label: "سبزی دلخواه", required: true, allowCustom: true },
      { id: "review", kind: "unresolved", label: "مبهم", required: true },
      { id: "optional", kind: "ingredient", name: "کشمش", required: false },
      { id: "tool", kind: "equipment", name: "قالب", required: true },
    ] };
    const choices = initialLibrarySelections(variant);
    expect(choices.tool).toBeUndefined(); expect(choices.optional.included).toBe(false);
    expect(selectedLibraryIngredients(variant, choices)).toBeNull();
    choices.or.name = "مرغ"; choices.herb.name = "جعفری"; choices.review.included = false;
    expect(selectedLibraryIngredients(variant, choices)).toEqual([
      { title: "برنج", catalogId: "preset:برنج", qty: null, unit: null },
      { title: "مرغ", catalogId: "preset:مرغکامل", qty: null, unit: null },
      { title: "جعفری", catalogId: "preset:جعفریتازه", qty: null, unit: null },
    ]);
    choices.or.name = "مرغ و گوشت";
    expect(selectedLibraryIngredients(variant, choices)).toBeNull();
  });

  it("switching the whole variant creates a fresh selection, not a union", () => {
    const a: LibraryVariant = { id: "a", needsReview: false, items: [{ id: "rice", kind: "ingredient", name: "برنج", required: true }] };
    const b: LibraryVariant = { id: "b", needsReview: false, items: [{ id: "lentil", kind: "ingredient", name: "عدس", required: true }] };
    const next = initialLibrarySelections(b);
    expect(next.rice).toBeUndefined();
    expect(selectedLibraryIngredients(a, initialLibrarySelections(a))?.[0].title).toBe("برنج");
    expect(selectedLibraryIngredients(b, next)?.[0].title).toBe("عدس");
  });
});
