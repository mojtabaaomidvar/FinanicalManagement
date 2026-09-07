import { describe, expect, it } from "vitest";
import { canEditRelation, relationLabel } from "./family.rules";

const owner = { id: "o1", role: "owner" as const, relation: "خودم" };
const wife = { id: "m1", role: "member" as const, relation: "همسر" };
const blank = { id: "m2", role: "member" as const, relation: "" };

describe("relationLabel", () => {
  it("مدیر همیشه «مدیر خانواده» است", () =>
    expect(relationLabel(owner)).toBe("مدیر خانواده"));

  it("نسبت واقعی عضو نمایش داده می‌شود", () =>
    expect(relationLabel(wife)).toBe("همسر"));

  it("نسبت خالی با «سایر» اشتباه گرفته نمی‌شود", () =>
    expect(relationLabel(blank)).toBe("نسبت ثبت نشده"));

  it("«خودم» برای عضو عادی بی‌معناست", () =>
    expect(relationLabel({ role: "member", relation: "خودم" })).toBe(
      "نسبت ثبت نشده",
    ));
});

describe("canEditRelation", () => {
  it("مدیر نسبت اعضا را عوض می‌کند", () =>
    expect(canEditRelation(owner, wife)).toBe(true));

  it("نسبت خود مدیر ثابت است", () =>
    expect(canEditRelation(owner, owner)).toBe(false));

  it("عضو نسبت خودش را عوض می‌کند", () =>
    expect(canEditRelation(wife, wife)).toBe(true));

  it("عضو نسبت عضو دیگر را عوض نمی‌کند", () =>
    expect(canEditRelation(wife, blank)).toBe(false));

  it("بدون کاربر، هیچ ویرایشی مجاز نیست", () =>
    expect(canEditRelation(null, wife)).toBe(false));
});
