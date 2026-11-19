import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/account/account.types";
import type { Member } from "@/domain/family/family.types";
import { suggestSmsAccount } from "./sms-parser-account-suggestion";
const members = [{ id: "self", name: "علی کریمی" }, { id: "other", name: "مریم کریمی" }] as Member[];
const accounts = [
  { id: "current", memberId: "self", title: "جاری ملی", bank: "ملی", kind: "bank", cardNumber: "6037991234567890" },
  { id: "saving", memberId: "self", title: "سپرده ملی", bank: "ملی", kind: "bank", cardNumber: "6037991234561111" },
  { id: "cash", memberId: "self", title: "نقد خانه", bank: null, kind: "wallet" },
  { id: "foreign", memberId: "other", title: "سپرده ملت", bank: "ملت", kind: "bank" },
] as Account[];
const suggestion = (text: string, rows = accounts, people = members) => suggestSmsAccount(text, rows, people, "self");
describe("SMS account review suggestions", () => {
  it("normalizes Arabic letters and suggests the unique matching owned account", () => {
    const result = suggestion("علي كريمي، برداشت از حساب جاری بانک ملی");
    expect(result.member?.id).toBe("self"); expect(result.account?.id).toBe("current");
  });
  it("suggests a foreign member name without exposing or assigning their account", () => {
    const result = suggestion("مریم کریمی؛ سپرده ملت واریز ۱۰۰ ریال");
    expect(result.member?.id).toBe("other"); expect(result.account).toBeNull();
  });
  it("does not guess between duplicate names, accounts, or bank-only matches", () => {
    expect(suggestion("بانک ملی برداشت ۱۰۰ ریال").account).toBeNull();
    expect(suggestion("علی کریمی جاری ملی", accounts, [...members, { id: "duplicate", name: "علی کریمی" } as Member]).account).toBeNull();
    expect(suggestion("کارت ****۷۸۹۰", [...accounts, { ...accounts[0], id: "duplicate" }]).account).toBeNull();
  });
  it("matches a masked card suffix, but not trailing digits in a monetary amount", () => {
    expect(suggestion("برداشت از کارت ****۷۸۹۰ به مبلغ ۲۰۰۰۰ ریال").account?.id).toBe("current");
    expect(suggestion("برداشت ۷۸۹۰ ریال").account).toBeNull();
  });
  it("matches cash type and rejects incompatible bank account types", () => {
    expect(suggestion("علی کریمی؛ برداشت نقدی").account?.id).toBe("cash");
    expect(suggestion("سپرده بانک ملی").account?.id).toBe("saving");
    expect(suggestion("جاری بانک ملت").account).toBeNull();
  });
  it("uses stored bank names and stable aliases rather than editable display labels", () => {
    expect(suggestion("جاری بانک ملی", [{ ...accounts[0], bank: "بانک ملی ایران" }]).account?.id).toBe("current");
    expect(suggestion("جاری بانک توسعه صادرات", [{ ...accounts[0], bank: "بانک صادرات ایران" }]).account).toBeNull();
  });
});
