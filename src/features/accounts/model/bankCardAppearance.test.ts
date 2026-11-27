import { describe, expect, it } from "vitest";
import { BANK_CATALOG } from "@/shared/lib/bankCatalog";
import { bankCardAppearance } from "./bankCardAppearance";

describe("local bank card appearance", () => {
  it("recognizes saved names, aliases and Persian card prefixes", () => {
    expect(bankCardAppearance("بانک ملی", "۶۰۳۷۹۹۰۰۰۰۰۰۰۰۰۰۰")?.id).toBe("melli");
    expect(bankCardAppearance(null, "۶۲۱۹۸۶۱۸۰۰۰۰۰۰۰۰۱")?.id).toBe("blubank");
    expect(bankCardAppearance("بانک سامان", "6219861800000001")?.id).toBe("saman");
  });
  it("does not guess ambiguous or unknown banks or contradictory card metadata", () => {
    expect(bankCardAppearance(null, "5022290000000001")).toBeNull();
    expect(bankCardAppearance("بانک ناموجود", "0000000000000000")).toBeNull();
    expect(bankCardAppearance("بانک ملت", "6037990000000000")).toBeNull();
    expect(bankCardAppearance(null, null)).toBeNull();
  });
  it("covers every catalog bank using local logos and validated colors", () => {
    for (const bank of BANK_CATALOG) {
      const appearance = bankCardAppearance(bank.value, null);
      expect(appearance?.id).toBe(bank.id);
      expect(appearance?.color).toMatch(/^#[\da-f]{6}$/i);
      expect(appearance?.logo).toBe(`/bank-logos/${bank.id}.png`);
    }
  });
});
