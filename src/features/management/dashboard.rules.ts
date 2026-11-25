import type { AnalyticsPoint, ModuleCounts } from "./analytics.types";

export type TrendField = Exclude<keyof AnalyticsPoint, "day">;
export const requestCount = (row: ModuleCounts) => row.creates + row.updates + row.completes + row.deletes;

export function chartScale(values: (number | null)[]) {
  const largest = Math.max(0, ...values.filter((value): value is number => value !== null));
  const rough = Math.max(1, largest / 4);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= rough)!;
  const maximum = Math.max(step, Math.ceil(largest / step) * step);
  return { maximum, ticks: Array.from({ length: Math.round(maximum / step) + 1 }, (_, index) => index * step) };
}

export function trendGeometry(points: AnalyticsPoint[], field: TrendField, width = 660) {
  const values = points.map(point => point[field]);
  const { maximum, ticks } = chartScale(values);
  // Time runs left to right; dates and controls remain Persian and RTL.
  const coordinates = values.map((value, index) => value === null ? null : ({
    x: 52 + (values.length < 2 ? 0.5 : index / (values.length - 1)) * (width - 80),
    y: 176 - value / maximum * 152,
  }));
  const segments: { x: number; y: number }[][] = [];
  let segment: { x: number; y: number }[] = [];
  for (const point of coordinates) {
    if (point) segment.push(point);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  return {
    maximum, ticks, coordinates, segments,
    total: values.length && values.every(value => value !== null)
      ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    available: values.some(value => value !== null),
    complete: values.length > 0 && values.every(value => value !== null),
  };
}

export function rankModules(modules: ModuleCounts[], metric: "opens" | "requests") {
  return modules.map(row => ({ module: row.module, value: metric === "opens" ? row.opens : requestCount(row) }))
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value || a.module.localeCompare(b.module));
}

export function resourcePercent(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used < 0) return null;
  return Math.min(100, Math.round(used / total * 100));
}
