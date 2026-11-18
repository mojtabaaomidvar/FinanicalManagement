import { describe, expect, it } from "vitest";
import { formatAmount, formatSignedAmount } from "./format";

describe("balance display", () => {
  it("shows an explicit minus and preserves a fractional negative balance", () => {
    expect(formatSignedAmount(-1250)).toBe("-۱,۲۵۰");
    expect(formatSignedAmount(-0.5)).toBe("-۰.۵");
  });

  it("keeps positive and zero balances readable without an extra sign", () => {
    expect(formatSignedAmount(1250.5)).toBe("۱,۲۵۰.۵");
    expect(formatSignedAmount(0)).toBe("۰");
  });

  it("preserves absolute amount labels for expense and income rows", () => {
    expect(formatAmount(-1250)).toBe("۱,۲۵۰");
  });
});
