import { describe, expect, it } from "vitest";
import { detectBank, extractDate, extractTime, parseSms } from "@/shared/lib/sms-parser";
import { smsDraftDefaults } from "./sms.rules";
import type { BankSms } from "./sms.types";
import { CATEGORIES, LEGACY_CATEGORIES, SYSTEM_CATEGORIES } from "../category/category.catalog";
import { validateTransaction } from "../transaction/transaction.rules";
import type { Transaction } from "../transaction/transaction.types";

describe("financial integrity", () => {
  it.each([...CATEGORIES, ...LEGACY_CATEGORIES, ...SYSTEM_CATEGORIES])("accepts $id only for $type", category => {
    const input = { memberId: "m", type: category.type, category: category.id, amount: 25000, date: "2026-11-24", accountId: "a", toAccountId: "b" };
    expect(validateTransaction(input).ok).toBe(true);
    expect(validateTransaction({ ...input, type: category.type === "income" ? "expense" : "income" }).error).toBe("INVALID_CATEGORY");
  });
  it("keeps an unchanged historically mismatched category editable, not newly creatable", () => {
    const input = { memberId: "m", type: "income" as const, category: "food", amount: 1000, date: "2026-11-24" };
    expect(validateTransaction(input).ok).toBe(false);
    expect(validateTransaction(input, input as Transaction).ok).toBe(true);
  });
  it.each(["موجودی", "دیروز", "today", "شهرستان", "سرمایه‌گذاری", "development"])("does not infer a bank from %s", text => {
    expect(detectBank(text)).toBeNull();
  });
  it.each([["بانک دی", "بانک دی"], ["Day Bank", "بانک دی"], ["بانک توسعه صادرات", "بانک توسعه صادرات"], ["بانک قرض‌الحسنه مهر ایران", "بانک مهر ایران"]])("identifies explicit %s", (raw, bank) => {
    expect(detectBank(raw)).toBe(bank);
  });
  it("does not choose among conflicting banks", () => expect(detectBank("بانک ملی بانک ملت")).toBeNull());
  it.each(["1405/07/31", "2026/02/30", "05/09/03", "03/09/2026", "1405/09/03 و 1405/09/04", "91405/09/03"])("requires review for %s", raw => {
    expect(extractDate(raw)).toBeNull();
  });
  it.each([["۱۴:۳۷:۵۲", "14:37:52"], ["9:07", "09:07"], ["00:00", "00:00"], ["23:59:59", "23:59:59"], ["24:00", null], ["12:60", null], ["12:00:61", null], ["12:00 و 13:00", null]])("extracts time %s", (raw, expected) => {
    expect(extractTime(raw!)).toBe(expected);
  });
  it("preserves raw units and seconds without auto-generated transaction notes", () => {
    const rawText = "برداشت مبلغ 250,000 ریال; موجودی 1,000,000; 1405/09/03-14:37:52";
    expect(parseSms(rawText)).toMatchObject({ bank: null, time: "14:37:52", amount: 250000 });
    const draft = smsDraftDefaults({ rawText, date: "2026-11-24", amount: 250000 } as BankSms, "m");
    expect(draft).toMatchObject({ amount: 25000, note: "", time: "14:37:52", jalaliDate: [1405, 9, 3] });
    expect(smsDraftDefaults({ rawText: "برداشت مبلغ 250000 ریال", date: "2026-11-24" } as BankSms, "m").jalaliDate).toBeNull();
  });
  it("rejects rollover dates and invalid manual times", () => {
    const input = { memberId: "m", type: "income" as const, category: "ride", amount: 25000, date: "2026-11-24" };
    expect(validateTransaction({ ...input, date: "2026-02-30" }).error).toBe("INVALID_DATE");
    expect(validateTransaction({ ...input, time: "24:00" }).error).toBe("INVALID_TIME");
    expect(validateTransaction({ ...input, time: "14:37:52" }).ok).toBe(true);
  });
});
