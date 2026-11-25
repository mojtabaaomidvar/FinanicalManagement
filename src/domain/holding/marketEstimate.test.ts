import { describe, expect, it } from "vitest";
import { marketEstimateText } from "./holding.rules";
import { addMoney } from "@/shared/lib/money";

describe("market estimate boundary (not ledger money)", () => {
  it("keeps fractional estimates without rounding to a currency unit", () => {
    expect(marketEstimateText(0.0000001)).toBe("0.0000001");
    expect(marketEstimateText(1.123456789)).toBe("1.123456789");
    expect(marketEstimateText(-0.0000001)).toBe("-0.0000001");
    expect(marketEstimateText(1e21)).toBe("1000000000000000000000");
  });
  it("adds represented quotes to already exact wallet cash without float summation", () => {
    expect(addMoney("9007199254740993.01", marketEstimateText(0.1)!, marketEstimateText(0.2)!)).toBe("9007199254740993.31");
  });
  it("does not substitute zero for a missing or out-of-range estimate", () => {
    for (const value of [NaN, Infinity, -Infinity, 1e308]) expect(marketEstimateText(value)).toBeNull();
  });
});
