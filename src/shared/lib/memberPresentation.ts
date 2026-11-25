/** Display-only abbreviation. Never changes the stored member name. */
export function memberFirstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? "";
}

/** Stable ID colours; resolve collisions within the visible family. */
export function memberHues(ids: string[]): Map<string, number> {
  const hues = new Map<string, number>(), used = new Set<number>();
  for (const id of [...new Set(ids)].sort()) {
    let hash = 2166136261;
    for (const letter of id) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
    let hue = (hash >>> 0) % 360;
    while (used.has(hue) && used.size < 360) hue = (hue + 137) % 360;
    hues.set(id, hue); used.add(hue);
  }
  return hues;
}
