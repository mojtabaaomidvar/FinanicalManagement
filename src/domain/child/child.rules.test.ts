import { afterEach, describe, expect, it, vi } from "vitest";
import { childError, todayTehran } from "./child.rules";

afterEach(() => vi.useRealTimers());

describe("child profile validation", () => {
  it("accepts an introduced child with an unknown birth date and no phone", () => {
    expect(childError({ name: "  سارا  ", birthDate: null }, "2026-11-15")).toBeNull();
  });
  it("accepts today's birth and rejects dates after the Tehran calendar day", () => {
    expect(childError({ name: "سارا", birthDate: "2026-11-15" }, "2026-11-15")).toBeNull();
    expect(childError({ name: "سارا", birthDate: "2026-11-16" }, "2026-11-15")).toContain("آینده");
  });
  it("rejects impossible, malformed and empty dates while allowing actual leap days", () => {
    for (const birthDate of ["2025-02-29", "2024-02-30", "2026-13-01", "2026-1-01", "", "invalid"])
      expect(childError({ name: "سارا", birthDate }, "2026-11-15")).toContain("تاریخ تولد معتبر");
    expect(childError({ name: "سارا", birthDate: "2024-02-29" }, "2026-11-15")).toBeNull();
  });
  it("requires a meaningful name within the profile limit", () => {
    for (const name of ["", "   ", "س".repeat(41)]) expect(childError({ name, birthDate: null })).toContain("نام فرزند");
    expect(childError({ name: "س".repeat(40), birthDate: null })).toBeNull();
  });
  it("validates on the Tehran date even when UTC is still the previous day", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T20:31:00Z"));
    expect(todayTehran()).toBe("2026-11-15");
    expect(childError({ name: "سارا", birthDate: "2026-11-15" })).toBeNull();
    vi.setSystemTime(new Date("2026-11-14T20:29:00Z"));
    expect(childError({ name: "سارا", birthDate: "2026-11-15" })).toContain("آینده");
  });
});
