import { toEn } from "@/shared/lib/digits";
import catalog from "./inventory.catalog.json";

export type InventoryCatalogGroup = keyof typeof catalog;

interface InventoryCatalogEntry {
  readonly id?: string;
  readonly catalog_id?: string;
  readonly title: string;
  readonly unit: string;
  readonly aliases?: readonly string[];
  readonly common?: boolean;
}

export interface InventorySuggestion extends InventoryCatalogEntry {
  readonly group: InventoryCatalogGroup;
}

const groups: Readonly<Record<InventoryCatalogGroup, readonly InventoryCatalogEntry[]>> = catalog;

export interface InventoryCatalogRepository {
  list(): Promise<InventorySuggestion[]>;
}

export const INVENTORY_PRESETS: readonly InventorySuggestion[] = (Object.keys(groups) as InventoryCatalogGroup[])
  .flatMap(group => groups[group].map(item => ({ ...item, group })));

export function inventoryCatalogId(suggestion: InventorySuggestion): string {
  return suggestion.catalog_id ?? suggestion.id ?? `preset:${searchKey(suggestion.title)}`;
}

export function isInventoryCatalogGroup(value: string): value is InventoryCatalogGroup {
  return Object.prototype.hasOwnProperty.call(groups, value);
}

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

function indexCatalog(entries: readonly InventorySuggestion[]) {
  return entries.map(suggestion => ({ group: suggestion.group, suggestion,
    titleKey: searchKey(suggestion.title), aliases: suggestion.aliases?.map(searchKey) ?? [] }));
}
const indexed = indexCatalog(INVENTORY_PRESETS);

export function mergeInventoryCatalog(entries: readonly InventorySuggestion[]): readonly InventorySuggestion[] {
  const merged = new Map(INVENTORY_PRESETS.map(item => [searchKey(item.title), item]));
  for (const entry of entries) {
    if (isInventoryCatalogGroup(entry.group) && searchKey(entry.title)) merged.set(searchKey(entry.title), entry);
  }
  return [...merged.values()];
}

export function exactInventorySuggestion(title: string, entries: readonly InventorySuggestion[] = INVENTORY_PRESETS): InventorySuggestion | null {
  const key = searchKey(title);
  if (!key) return null;
  const source = entries === INVENTORY_PRESETS ? indexed : indexCatalog(entries);
  const exact = source.filter(entry => entry.titleKey === key);
  const matches = exact.length ? exact : source.filter(entry => entry.aliases.includes(key));
  return matches.length === 1 ? matches[0].suggestion : null;
}

/** Automatic defaults must not carry over from a known item to an unknown name. */
export function inventoryNameFields<T extends { title: string; unit: string; category: InventoryCatalogGroup | "" }>(
  previous: T, title: string, entries: readonly InventorySuggestion[] = INVENTORY_PRESETS,
): T {
  const next = exactInventorySuggestion(title, entries);
  if (next) return { ...previous, title, category: next.group, unit: next.unit };
  const before = exactInventorySuggestion(previous.title, entries);
  return { ...previous, title,
    category: before && previous.category === before.group ? "" : previous.category,
    unit: before && previous.unit === before.unit ? "" : previous.unit };
}

export function inventoryCategory(item: { title: string; category?: string | null }, entries: readonly InventorySuggestion[] = INVENTORY_PRESETS): InventoryCatalogGroup | null {
  if (item.category && Object.prototype.hasOwnProperty.call(groups, item.category)) return item.category as InventoryCatalogGroup;
  const key = searchKey(item.title);
  if (!key) return null;
  const source = entries === INVENTORY_PRESETS ? indexed : indexCatalog(entries);
  const exact = source.filter(entry => entry.titleKey === key);
  const matches = exact.length ? exact : source.filter(entry => entry.aliases.includes(key));
  const categories = new Set(matches.map(entry => entry.group));
  return categories.size === 1 ? categories.values().next().value! : null;
}

export function findInventorySuggestions(
  query: string,
  group: InventoryCatalogGroup | readonly InventoryCatalogGroup[] | null,
  inventory: readonly { title: string }[],
  entries: readonly InventorySuggestion[] = INVENTORY_PRESETS,
): InventorySuggestion[] {
  const words = searchWords(query);
  const search = words.join("");
  if (!search && query.trim()) return [];
  const selectedGroups = group === null ? null : new Set(typeof group === "string" ? [group] : group);
  const tracked = new Set(inventory.map(item => searchKey(item.title)));
  const source = entries === INVENTORY_PRESETS ? indexed : indexCatalog(entries);
  return source.flatMap(({ group: itemGroup, suggestion, titleKey, aliases }) => {
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
