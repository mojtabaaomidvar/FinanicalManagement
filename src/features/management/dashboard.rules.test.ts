import { describe, expect, it } from "vitest";
import { chartScale, rankModules, requestCount, resourcePercent, trendGeometry } from "./dashboard.rules";
import type { AnalyticsPoint, ModuleCounts } from "./analytics.types";

const points = (values: (number | null)[]): AnalyticsPoint[] => values.map((value, index) => ({
  day: `2026-11-${20 + index}`, families_created: value ?? 0, registrations_completed: 0,
  opens: value, requests: value, errors: 0,
}));

describe("management dashboard charts", () => {
  it("keeps a zero baseline and integer ticks for small and large counts", () => {
    for (const values of [[0, 0], [1, 3], [13, 47], [10000, 91001], [null, null]]) {
      const result = chartScale(values);
      expect(result.ticks[0]).toBe(0);
      expect(result.maximum).toBeGreaterThanOrEqual(Math.max(0, ...values.map(value => value ?? 0)));
      expect(result.ticks.every(Number.isInteger)).toBe(true);
      expect(result.ticks.at(-1)).toBe(result.maximum);
    }
  });
  it("draws gaps and withholds the total when even one count is unavailable", () => {
    const result = trendGeometry(points([3, null, 2, 4]), "requests");
    expect(result.segments.map(segment => segment.length)).toEqual([1, 2]);
    expect(result.total).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.coordinates[1]).toBeNull();
    expect(result.available).toBe(true);
  });
  it("distinguishes measured zeros from missing or empty data", () => {
    expect(trendGeometry(points([0, 0]), "opens")).toMatchObject({ total: 0, available: true, complete: true });
    expect(trendGeometry(points([null, null]), "opens")).toMatchObject({ total: null, available: false });
    expect(trendGeometry([], "opens")).toMatchObject({ total: null, available: false });
  });
  it("handles one point and preserves the exact numeric total and chronological direction", () => {
    const one = trendGeometry(points([8]), "requests");
    expect(one.coordinates[0]).toEqual({ x: 342, y: 24 });
    const result = trendGeometry(points([1, 3, 6]), "requests");
    expect(result.total).toBe(10);
    expect(result.coordinates[0]!.x).toBeLessThan(result.coordinates[2]!.x);
    expect(result.coordinates.every(point => Number.isFinite(point!.y))).toBe(true);
  });
  it("ranks real module counts without mutating input or treating opens as requests", () => {
    const rows: ModuleCounts[] = [
      { module: "shopping", opens: 2, creates: 1, updates: 2, completes: 3, deletes: 4 },
      { module: "tasks", opens: 12, creates: 1, updates: 0, completes: 1, deletes: 0 },
      { module: "reports", opens: 0, creates: 0, updates: 0, completes: 0, deletes: 0 },
    ];
    expect(requestCount(rows[0])).toBe(10);
    expect(rankModules(rows, "requests")).toEqual([{ module: "shopping", value: 10 }, { module: "tasks", value: 2 }]);
    expect(rankModules(rows, "opens")[0]).toEqual({ module: "tasks", value: 12 });
    expect(rows[0].module).toBe("shopping");
  });
  it("never converts an unknown resource total to zero percent", () => {
    expect(resourcePercent(1, 0)).toBeNull();
    expect(resourcePercent(NaN, 100)).toBeNull();
    expect(resourcePercent(-1, 100)).toBeNull();
    expect(resourcePercent(0, 100)).toBe(0);
    expect(resourcePercent(67, 100)).toBe(67);
    expect(resourcePercent(101, 100)).toBe(100);
  });
});
