import type { HomeGroupId, HomePreferences } from "./homePreferences.types";

export const HOME_GROUPS: ReadonlyArray<{
  id: HomeGroupId;
  title: string;
  modules: readonly string[];
}> = [
  { id: "money", title: "مالی خانه", modules: ["finance", "transactions", "accounts", "budgets", "bills", "market", "reports"] },
  { id: "daily", title: "کارهای روزمرهٔ خانه", modules: ["chores", "shopping", "inventory", "meals"] },
  { id: "belongings", title: "وسایل و مدارک", modules: ["equipment", "vehicles", "docs"] },
  { id: "family", title: "خانواده و برنامه‌ها", modules: ["calendar", "activities", "children", "pets", "goals"] },
];

export const HOME_MODULE_IDS: readonly string[] = HOME_GROUPS.flatMap((group) => group.modules);
const groupIds = HOME_GROUPS.map((group) => group.id);
const moduleIds = new Set(HOME_MODULE_IDS);

export function defaultHomePreferences(): HomePreferences {
  return {
    version: 1,
    layout: "grouped",
    pins: ["chores", "shopping", "calendar"],
    openGroups: [],
    groupOrder: [...groupIds],
    groupModules: {
      money: [...HOME_GROUPS[0].modules],
      daily: [...HOME_GROUPS[1].modules],
      belongings: [...HOME_GROUPS[2].modules],
      family: [...HOME_GROUPS[3].modules],
    },
    flatOrder: [...HOME_MODULE_IDS],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function uniqueKnown(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && known.has(id)))];
}

/** Repair old or incomplete arrangements without discarding deliberate empty groups. */
export function normalizeHomePreferences(value: unknown): HomePreferences {
  const source = record(value);
  const defaults = defaultHomePreferences();
  const knownGroups = new Set<string>(groupIds);
  const groupOrder = uniqueKnown(source.groupOrder, knownGroups);
  groupOrder.push(...groupIds.filter((id) => !groupOrder.includes(id)));
  const savedGroups = record(source.groupModules);
  const groupModules = {} as Record<HomeGroupId, string[]>;
  const assigned = new Set<string>();
  // Use the personal group order to resolve duplicate membership deterministically.
  for (const id of groupOrder as HomeGroupId[]) {
    groupModules[id] = uniqueKnown(savedGroups[id], moduleIds).filter((moduleId) => {
      if (assigned.has(moduleId)) return false;
      assigned.add(moduleId);
      return true;
    });
  }
  for (const group of HOME_GROUPS) {
    for (const id of group.modules) {
      if (!assigned.has(id)) {
        groupModules[group.id].push(id);
        assigned.add(id);
      }
    }
  }
  const flatOrder = uniqueKnown(source.flatOrder, moduleIds);
  flatOrder.push(...HOME_MODULE_IDS.filter((id) => !flatOrder.includes(id)));
  return {
    version: 1,
    layout: source.layout === "flat" ? "flat" : "grouped",
    pins: Array.isArray(source.pins) ? uniqueKnown(source.pins, moduleIds) : defaults.pins,
    // Older versions saved several expanded groups in opening order.
    // Retain the most recently opened known group for the exclusive accordion.
    openGroups: Array.isArray(source.openGroups) ? uniqueKnown(source.openGroups, knownGroups).slice(-1) : defaults.openGroups,
    groupOrder,
    groupModules,
    flatOrder,
  };
}

/** The insertion index is measured after removing this item. */
export function reorderHomeItem(list: string[], id: string, index: number): string[] {
  const result = list.filter((value) => value !== id);
  const at = Number.isFinite(index) ? Math.max(0, Math.min(result.length, Math.trunc(index))) : result.length;
  result.splice(at, 0, id);
  return result;
}

export function homeModuleGroup(preferences: HomePreferences, id: string): HomeGroupId | undefined {
  return groupIds.find((groupId) => preferences.groupModules[groupId].includes(id));
}

/** Pins and the independent flat order remain unchanged when moving a catalog tile. */
export function moveHomeModule(
  preferences: HomePreferences,
  id: string,
  groupId: HomeGroupId,
  index: number,
): HomePreferences {
  const result = normalizeHomePreferences(preferences);
  if (!moduleIds.has(id) || !groupIds.includes(groupId)) return result;
  for (const group of HOME_GROUPS) {
    result.groupModules[group.id] = result.groupModules[group.id].filter((value) => value !== id);
  }
  result.groupModules[groupId] = reorderHomeItem(result.groupModules[groupId], id, index);
  return result;
}
