import { expect, it } from "vitest";
import { smoothChartPath } from "./smoothChartPath";

it.each([[80, 80, 80], [90, 10, 90, 20], [100, 99, 0], [0, 100, 101, 102]].map(values => ({ values })))("passes all samples without overshoot: $values", ({ values }) => {
  const points = values.map((y, i) => ({ x: i * 10, y }));
  const d = smoothChartPath(points);
  const curves = d.split(" C").slice(1);
  expect(curves).toHaveLength(values.length - 1);
  for (const [i, curve] of curves.entries()) {
    const [x1, y1, x2, y2, x, y] = curve.split(/[ ,]/).map(Number);
    expect([x, y]).toEqual([points[i + 1].x, values[i + 1]]);
    for (let t = 0; t <= 1; t += .01) {
      const v = (1 - t) ** 3 * values[i] + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y;
      expect(v).toBeGreaterThanOrEqual(Math.min(values[i], y) - 1e-9);
      expect(v).toBeLessThanOrEqual(Math.max(values[i], y) + 1e-9);
    }
    expect(x1).toBeLessThan(x2);
  }
});
