import { describe, expect, it, vi } from "vitest";
import type { FamilyRepository } from "@/domain/family/family.repository";
import { defaultHomePreferences } from "@/domain/home/homePreferences.rules";
import { GetHomePreferencesUseCase, SetHomePreferencesUseCase } from "./family.usecases";

describe("personal home preference use cases", () => {
  it("reads the own-member snapshot unchanged", async () => {
    const snapshot = { revision: 2, preferences: defaultHomePreferences() };
    const getHomePreferences = vi.fn(async () => snapshot);
    const repo = { getHomePreferences } as unknown as FamilyRepository;
    expect(await new GetHomePreferencesUseCase(repo).execute()).toBe(snapshot);
    expect(getHomePreferences).toHaveBeenCalledOnce();
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects invalid revision %s before writing", (revision) => {
    const setHomePreferences = vi.fn();
    const repo = { setHomePreferences } as unknown as FamilyRepository;
    expect(() => new SetHomePreferencesUseCase(repo).execute(revision, defaultHomePreferences())).toThrow("نسخهٔ چیدمان معتبر نیست");
    expect(setHomePreferences).not.toHaveBeenCalled();
  });

  it("normalizes the submitted catalog and retains the requested revision", async () => {
    const snapshot = { revision: 1, preferences: defaultHomePreferences() };
    const setHomePreferences = vi.fn(async () => snapshot);
    const repo = { setHomePreferences } as unknown as FamilyRepository;
    const preferences = { ...defaultHomePreferences(), pins: ["calendar", "calendar", "unknown"] };
    expect(await new SetHomePreferencesUseCase(repo).execute(0, preferences)).toBe(snapshot);
    expect(setHomePreferences).toHaveBeenCalledWith(0, { ...defaultHomePreferences(), pins: ["calendar"] });
    expect(preferences.pins).toEqual(["calendar", "calendar", "unknown"]);
  });
});
