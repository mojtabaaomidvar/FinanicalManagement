import { describe, expect, it } from "vitest";
import { BANK_OPTIONS, bankOfCard, cardMatchesBank } from "./banks";
describe("IranianBanks directory", () => {
  it("contains all upstream institutions", () => {
    expect(BANK_OPTIONS).toHaveLength(37);
    expect(BANK_OPTIONS.some(bank => bank.value === "بانک اقتصاد نوین")).toBe(true);
  });
  it("uses the most specific prefix, including Persian digits", () => {
    expect(bankOfCard("۶۲۱۹۸۶۱۸۱۲۳۴۵۶۷۸")).toBe("بلوبانک (نئوبانک سامان)");
    expect(bankOfCard("6219860012345678")).toBe("بانک سامان");
    expect(cardMatchesBank("6219861812345678", "بانک سامان")).toBe(true);
  });
  it("requires a choice for ambiguous prefixes", () => {
    for (const prefix of ["502229", "505785", "504172", "627760"]) expect(bankOfCard(prefix)).toBeNull();
    expect(cardMatchesBank("5057851234567890", "بانک ایران‌زمین")).toBe(true);
    expect(cardMatchesBank("5057851234567890", "بانک ملت")).toBe(false);
  });
  it("preserves legacy names and removes incorrect assignments", () => {
    expect(cardMatchesBank("6037991234567890", "بانک ملی")).toBe(true);
    expect(cardMatchesBank("6037691234567890", "بانک سپه")).toBe(false);
    expect(cardMatchesBank("6273531234567890", "بانک تجارت")).toBe(true);
  });
});
