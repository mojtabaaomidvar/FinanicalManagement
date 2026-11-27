import { expect, it } from "vitest";
import { memberFirstName, memberHues } from "./memberPresentation";

it("abbreviates display without breaking a joined Persian first name", () => {
  expect(memberFirstName("  محمد‌رضا احمدی ")).toBe("محمد‌رضا");
  expect(memberFirstName("Mina Omidvar")).toBe("Mina");
});
it("keeps member colours distinct and independent of row/order/name", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `member-${i}`);
  expect(new Set(memberHues(ids).values()).size).toBe(ids.length);
  expect(memberHues(ids)).toEqual(memberHues(ids.reverse()));
});
