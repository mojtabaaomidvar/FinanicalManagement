import { expect, it } from "vitest";
import { formatAccountAmount } from "./format";
it("retains one-rial balances and legacy transaction fractions while rounding only toman presentation", () => {
  expect(formatAccountAmount(1499.9, "ریال")).toBe("۱۴,۹۹۹");
  expect(formatAccountAmount(1499.9, "تومان")).toBe("۱,۵۰۰");
  expect(formatAccountAmount(-1.1, "ریال")).toBe("-۱۱");
  expect(formatAccountAmount(1.01, "ریال")).toBe("۱۰.۱");
});
