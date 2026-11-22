import { toEn } from "@/shared/lib/digits";
import catalog from "./inventory.catalog.json";

export type InventoryCatalogGroup = keyof typeof catalog;

interface InventoryCatalogEntry {
  readonly title: string;
  readonly unit: string;
  readonly aliases?: readonly string[];
  readonly common?: boolean;
}

export interface InventorySuggestion extends InventoryCatalogEntry {
  readonly group: InventoryCatalogGroup;
}

const groups: Readonly<Record<InventoryCatalogGroup, readonly InventoryCatalogEntry[]>> = catalog;

export const INVENTORY_CATALOG_SECTIONS = {
  dry: ["grains", "baking", "preserves", "oils_sauces"],
  fresh: ["vegetables", "fruit"],
  chilled: ["refrigerated", "proteins"],
  frozen: ["frozen"],
  legumes: ["legumes"],
  seasonings: ["seasonings"],
  breakfast: ["breakfast"],
  refreshments: ["drinks", "snacks"],
  household: ["cleaning", "disposables", "personal_care", "baby_care", "first_aid", "textile_care", "stationery", "pets", "garden"],
  maintenance: ["electrical", "plumbing", "repairs", "appliance_supplies", "emergency", "garage"],
} as const satisfies Record<string, readonly InventoryCatalogGroup[]>;

export type InventoryCatalogSection = keyof typeof INVENTORY_CATALOG_SECTIONS;

// Search tolerates Persian keyboard variants, half-spaces and mixed-script product codes.
function searchWords(value: string): string[] {
  return toEn(value.normalize("NFKC")).toLowerCase()
    .replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/[آأإٱ]/g, "ا")
    .replace(/[ۀە]/g, "ه").replace(/[\p{M}\p{Cf}ـ]/gu, "")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const searchKey = (value: string) => searchWords(value).join("");

const indexed = (Object.keys(groups) as InventoryCatalogGroup[]).flatMap(group =>
  groups[group].map(suggestion => ({
    group, suggestion: { ...suggestion, group }, titleKey: searchKey(suggestion.title), aliases: suggestion.aliases?.map(searchKey) ?? [],
  })),
);

export function inventoryCategory(item: { title: string; category?: string | null }): InventoryCatalogGroup | null {
  if (item.category && Object.prototype.hasOwnProperty.call(groups, item.category)) return item.category as InventoryCatalogGroup;
  const key = searchKey(item.title);
  if (!key) return null;
  const exact = indexed.filter(entry => entry.titleKey === key);
  const matches = exact.length ? exact : indexed.filter(entry => entry.aliases.includes(key));
  const categories = new Set(matches.map(entry => entry.group));
  return categories.size === 1 ? categories.values().next().value! : null;
}

export function findInventorySuggestions(
  query: string,
  group: InventoryCatalogGroup | readonly InventoryCatalogGroup[] | null,
  inventory: readonly { title: string }[],
): InventorySuggestion[] {
  const words = searchWords(query);
  const search = words.join("");
  if (!search && query.trim()) return [];
  const selectedGroups = group === null ? null : new Set(typeof group === "string" ? [group] : group);
  const tracked = new Set(inventory.map(item => searchKey(item.title)));
  return indexed.flatMap(({ group: itemGroup, suggestion, titleKey, aliases }) => {
    if ((selectedGroups && !selectedGroups.has(itemGroup)) || tracked.has(titleKey)) return [];
    const keys = [titleKey, ...aliases];
    const score = !search ? 0 : titleKey === search ? 5 : aliases.includes(search) ? 4
      : keys.some(key => key.startsWith(search)) ? 3
      : keys.some(key => key.includes(search)) ? 2
      : keys.some(key => words.every(word => key.includes(word))) ? 1 : -1;
    return score < 0 ? [] : [{ suggestion, score }];
  }).sort((a, b) => b.score - a.score || Number(!!b.suggestion.common) - Number(!!a.suggestion.common))
    .map(result => result.suggestion);
}
