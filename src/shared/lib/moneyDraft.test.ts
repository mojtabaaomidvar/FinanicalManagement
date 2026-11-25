import { describe, expect, it } from "vitest";
import { convertMoneyDraft } from "./moneyDraft";
import { parseMoneyInput } from "./money";

describe("input unit switching", () => {
  it.each(["۰.۰۱", "۱۴۹۹.۹", "-۹۹۹۹۹۹۹۹۹۹۹۸.۹۹", "۰", "۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵.۶۷"])("preserves %s without Number or rounding", raw => {
    const rial = convertMoneyDraft(raw, "تومان", "ریال")!;
    const toman = convertMoneyDraft(rial, "ریال", "تومان")!;
    expect(parseMoneyInput(toman, "تومان")).toBe(parseMoneyInput(raw, "تومان"));
  });
  it("keeps empty slots and rejects incomplete or authored non-money text", () => {
    expect(convertMoneyDraft("", "تومان", "ریال")).toBe("");
    expect(convertMoneyDraft("  ", "تومان", "ریال")).toBe("  ");
    for (const raw of ["-", "۱ +", "تومان ۱۰۰", "1e4"]) expect(convertMoneyDraft(raw, "تومان", "ریال")).toBeNull();
  });
});
