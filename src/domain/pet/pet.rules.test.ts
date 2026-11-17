import { afterEach, describe, expect, it, vi } from "vitest";
import { petCareError, petError, petTodayTehran } from "./pet.rules";

afterEach(() => vi.useRealTimers());
const profile = { name: "پیشی", species: "گربه", breed: null, birthDate: null };

describe("pet profile validation", () => {
  it("accepts the basic profile without breed or birth date", () => { expect(petError(profile)).toBeNull(); });
  it("requires name and species within the approved bounds", () => {
    for (const name of ["", "  ", "پ".repeat(81)]) expect(petError({ ...profile, name })).toContain("نام حیوان");
    for (const species of ["", "  ", "گ".repeat(61)]) expect(petError({ ...profile, species })).toContain("نوع حیوان");
    expect(petError({ ...profile, breed: "گ".repeat(101) })).toContain("نژاد");
    expect(petError({ ...profile, name: "پ".repeat(80), species: "گ".repeat(60), breed: "ن".repeat(100) })).toBeNull();
  });
  it("rejects impossible or future birthdays and accepts today's birth", () => {
    for (const birthDate of ["2025-02-29", "2026-02-30", "2026-1-01", "", "invalid"]) expect(petError({ ...profile, birthDate }, "2026-11-15")).toContain("تاریخ تولد معتبر");
    expect(petError({ ...profile, birthDate: "2026-11-16" }, "2026-11-15")).toContain("آینده");
    expect(petError({ ...profile, birthDate: "2026-11-15" }, "2026-11-15")).toBeNull();
    expect(petError({ ...profile, birthDate: "2024-02-29" }, "2026-11-15")).toBeNull();
  });
  it("uses Tehran's calendar day across UTC midnight offset", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T20:31:00Z"));
    expect(petTodayTehran()).toBe("2026-11-15"); expect(petError({ ...profile, birthDate: "2026-11-15" })).toBeNull();
    vi.setSystemTime(new Date("2026-11-14T20:29:00Z")); expect(petError({ ...profile, birthDate: "2026-11-15" })).toContain("آینده");
  });
});

describe("canonical care task validation", () => {
  it("accepts optional due dates and assignee without adding pet metadata to Tasks", () => {
    expect(petCareError({ title: "غذا دادن", assigneeId: null, dueDate: null }, [])).toBeNull();
    expect(petCareError({ title: "غذا دادن", assigneeId: "introduced-child", dueDate: "2026-11-15" }, ["introduced-child"])).toBeNull();
  });
  it("rejects unlisted assignees, blank titles and impossible due dates", () => {
    expect(petCareError({ title: "غذا دادن", assigneeId: "foreign-member", dueDate: null }, ["member"])).toContain("مسئول");
    expect(petCareError({ title: "  ", assigneeId: null, dueDate: null }, [])).toContain("عنوان");
    expect(petCareError({ title: "غذا دادن", assigneeId: null, dueDate: "2026-02-30" }, [])).toContain("موعد");
  });
});
