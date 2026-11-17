import { describe, expect, it } from "vitest";
import { homeTodayIso } from "./useHomeToday";

describe("Home Tehran calendar day", () => {
  it("uses Tehran's day after local midnight while UTC is still the previous day", () => {
    expect(homeTodayIso(new Date("2026-11-15T20:29:59Z"))).toBe("2026-11-15");
    expect(homeTodayIso(new Date("2026-11-15T20:30:00Z"))).toBe("2026-11-16");
  });
  it("handles month and year transitions without the host timezone", () => {
    expect(homeTodayIso(new Date("2026-12-31T21:00:00Z"))).toBe("2027-01-01");
    expect(homeTodayIso(new Date("2026-11-30T21:00:00Z"))).toBe("2026-12-01");
  });
});
