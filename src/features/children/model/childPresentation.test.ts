import { describe, expect, it } from "vitest";
import type { Child } from "@/domain/child/child.types";
import { childAgeLabel, childStatusLabel, filterChildren } from "./childPresentation";

describe("child profile presentation", () => {
  it("distinguishes newborns, unknown age and known age", () => {
    expect(childAgeLabel({ ageYears: 0 })).toBe("کمتر از یک سال");
    expect(childAgeLabel({ ageYears: null })).toBe("سن مشخص نشده");
    expect(childAgeLabel({ ageYears: 12 })).toBe("۱۲ سال");
  });
  it("describes introduced children without representing them as awaiting membership approval", () => {
    expect(childStatusLabel({ status: "pending" })).toBe("ثبت‌شده توسط مدیر");
    expect(childStatusLabel({ status: "active" })).toBe("حساب فعال");
  });
  it("finds a child by name without requiring a phone or exposing additional profile data", () => {
    const children = [{ id: "a", name: "سارا" }, { id: "b", name: "آرمان" }] as Child[];
    expect(filterChildren(children, "  سار  ")).toEqual([children[0]]);
    expect(filterChildren(children, "")).toEqual(children);
  });
});
