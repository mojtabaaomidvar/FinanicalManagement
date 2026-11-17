import { describe, expect, it } from "vitest";
import { ACTIVE_MODULES } from "@/pages/HubPage/modules";
import {
  HOME_GROUPS, HOME_MODULE_IDS, defaultHomePreferences, homeModuleGroup,
  moveHomeModule, normalizeHomePreferences, reorderHomeItem,
} from "./homePreferences.rules";

const catalog = (value: ReturnType<typeof defaultHomePreferences>) => Object.values(value.groupModules).flat();

describe("personal home arrangement", () => {
  it("covers every navigable module exactly once and keeps the catalog synchronized", () => {
    expect([...HOME_MODULE_IDS].sort()).toEqual(ACTIVE_MODULES.map((module) => module.id).sort());
    expect(HOME_MODULE_IDS).toHaveLength(19);
    const defaults = defaultHomePreferences();
    expect(new Set(catalog(defaults)).size).toBe(19);
    expect(defaults.groupOrder).toEqual(["money", "daily", "belongings", "family"]);
    expect(defaults.pins).toEqual(["chores", "shopping", "calendar"]);
  });

  it.each([null, undefined, false, "invalid", 123, []])("returns independent defaults for malformed input %j", (value) => {
    expect(normalizeHomePreferences(value)).toEqual(defaultHomePreferences());
  });

  it("migrates pins and expanded groups from the first prototype without requiring new fields", () => {
    const result = normalizeHomePreferences({ pins: ["goals", "calendar"], openGroups: ["family"] });
    expect(result).toEqual({ ...defaultHomePreferences(), pins: ["goals", "calendar"], openGroups: ["family"] });
  });

  it("restores only the last known expanded group from older multi-open arrangements", () => {
    const original = { ...defaultHomePreferences(), openGroups: ["money", "daily", "family", "gone"] };
    const result = normalizeHomePreferences(original);
    expect(result.openGroups).toEqual(["family"]);
    expect(result.groupOrder).toEqual(original.groupOrder);
    expect(result.groupModules).toEqual(original.groupModules);
    expect(original.openGroups).toEqual(["money", "daily", "family", "gone"]);
  });

  it("filters unknown and duplicate IDs while retaining personal membership and both orders", () => {
    const result = normalizeHomePreferences({
      layout: "flat", pins: ["goals", "goals", "gone", null], openGroups: ["family", "family", "gone"],
      groupOrder: ["family", "money", "family", "gone"],
      groupModules: { family: ["finance", "goals", "finance"], money: ["finance", "bills", "gone"], daily: ["shopping"] },
      flatOrder: ["shopping", "shopping", "goals", "gone"],
    });
    expect(result.layout).toBe("flat");
    expect(result.pins).toEqual(["goals"]);
    expect(result.openGroups).toEqual(["family"]);
    expect(result.groupOrder).toEqual(["family", "money", "daily", "belongings"]);
    expect(result.groupModules.family.slice(0, 2)).toEqual(["finance", "goals"]);
    expect(result.groupModules.money).not.toContain("finance");
    expect(result.flatOrder.slice(0, 2)).toEqual(["shopping", "goals"]);
    expect(catalog(result)).toHaveLength(19);
    expect(new Set(catalog(result)).size).toBe(19);
    expect(new Set(result.flatOrder).size).toBe(19);
  });

  it("retains deliberately empty groups, no pins and all groups collapsed", () => {
    const defaults = defaultHomePreferences();
    defaults.groupModules.family.push(...defaults.groupModules.money);
    defaults.groupModules.money = [];
    defaults.pins = [];
    defaults.openGroups = [];
    expect(normalizeHomePreferences(defaults)).toEqual(defaults);
  });

  it("appends newly available or missing modules into their default groups", () => {
    const defaults = defaultHomePreferences();
    defaults.groupModules.money = ["bills", "transactions"];
    defaults.flatOrder = ["calendar", "shopping"];
    const result = normalizeHomePreferences(defaults);
    expect(result.groupModules.money).toEqual(["bills", "transactions", "finance", "accounts", "budgets", "market", "reports"]);
    expect(result.flatOrder.slice(0, 2)).toEqual(["calendar", "shopping"]);
    expect(result.flatOrder).toHaveLength(19);
  });

  it("does not share nested arrays between defaults, normalized snapshots or input", () => {
    const original = defaultHomePreferences();
    const result = normalizeHomePreferences(original);
    result.pins.reverse(); result.groupModules.money.reverse(); result.groupOrder.reverse(); result.openGroups.pop(); result.flatOrder.reverse();
    expect(original).toEqual(defaultHomePreferences());
  });

  it("uses the insertion position after removal, bounds it and never mutates the source", () => {
    const original = ["a", "b", "c"];
    expect(reorderHomeItem(original, "a", 2)).toEqual(["b", "c", "a"]);
    expect(reorderHomeItem(original, "c", -3)).toEqual(["c", "a", "b"]);
    expect(reorderHomeItem(original, "b", 999)).toEqual(["a", "c", "b"]);
    expect(reorderHomeItem(original, "b", Number.NaN)).toEqual(["a", "c", "b"]);
    expect(original).toEqual(["a", "b", "c"]);
  });

  it("adds a new shortcut without duplicating it", () => {
    expect(reorderHomeItem(["chores", "shopping"], "calendar", 1)).toEqual(["chores", "calendar", "shopping"]);
    expect(reorderHomeItem(["chores", "shopping"], "shopping", 1)).toEqual(["chores", "shopping"]);
  });

  it("moves a module into another or empty group, preserving independent pins and flat order", () => {
    const original = defaultHomePreferences();
    original.groupModules.family.push(...original.groupModules.belongings);
    original.groupModules.belongings = [];
    const result = moveHomeModule(original, "shopping", "belongings", 0);
    expect(result.groupModules.belongings).toEqual(["shopping"]);
    expect(result.groupModules.daily).not.toContain("shopping");
    expect(result.pins).toEqual(original.pins);
    expect(result.flatOrder).toEqual(original.flatOrder);
    expect(original.groupModules.belongings).toEqual([]);
    expect(homeModuleGroup(result, "shopping")).toBe("belongings");
    expect(homeModuleGroup(result, "unknown")).toBeUndefined();
    expect(catalog(result)).toHaveLength(19);
  });

  it("preserves exact catalog coverage across repeated arbitrary transfers and normalization", () => {
    let result = defaultHomePreferences();
    for (let index = 0; index < 120; index++) {
      result = moveHomeModule(result, HOME_MODULE_IDS[index % 19], HOME_GROUPS[index % 4].id, index % 7);
      expect(catalog(result).sort()).toEqual([...HOME_MODULE_IDS].sort());
      expect(normalizeHomePreferences(result)).toEqual(result);
    }
  });
});
