export interface ChartPoint { x: number; y: number }

/** Monotone cubic interpolation: hits each sample and cannot invent extrema. */
export function smoothChartPath(points: ChartPoint[]): string {
  if (!points.length) return "";
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x));
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0] ?? 0;
    if (i === points.length - 1) return slopes[i - 1] ?? 0;
    const a = slopes[i - 1], b = slopes[i];
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  });
  return `M${points[0].x},${points[0].y}` + points.slice(1).map((point, i) => {
    const previous = points[i], dx = (point.x - previous.x) / 3;
    return ` C${previous.x + dx},${previous.y + tangents[i] * dx} ${point.x - dx},${point.y - tangents[i + 1] * dx} ${point.x},${point.y}`;
  }).join("");
}
