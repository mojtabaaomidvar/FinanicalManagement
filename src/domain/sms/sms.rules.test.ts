import { describe, expect, it } from "vitest";
import type { BankSms } from "./sms.types";
import { smsAmountInToman, smsDraftDefaults } from "./sms.rules";

describe("SMS numeric units", () => {
  it.each([
    ["برداشت مبلغ ۲۵۰,۰۰۰ ریال؛ موجودی ۹۰۰,۰۰۰ ریال", 250000, 25000],
    ["واریز مبلغ ۱۲۵٬۰۰۰ تومان", 125000, 125000],
    ["برداشت مبلغ 250000 ریال؛ موجودی 500000 تومان", 250000, 25000],
    ["مبلغ 250000؛ واحد ریال", 250000, 25000],
    ["برداشت مبلغ 250000", 250000, null],
    ["مبلغ 250000 ریال و 250000 تومان", 250000, null],
    ["مبلغ نامعتبر ریال", 0, null],
  ])("normalizes only an unambiguous unit: %s", (raw, amount, expected) => {
    expect(smsAmountInToman(raw as string, amount as number)).toBe(expected);
  });
  it("keeps stored SMS numbers in their original units while building base-currency drafts", () => {
    const sms = { rawText: "برداشت مبلغ ۲۵۰۰۰۰ ریال", amount: 250000, date: "2026-11-19", type: "expense", memberId: "actor" } as BankSms;
    expect(smsDraftDefaults(sms, "actor")).toMatchObject({ amount: 25000, amountNeedsReview: false });
    expect(sms.amount).toBe(250000);
    expect(smsDraftDefaults({ ...sms, rawText: "برداشت مبلغ 250000" }, "actor"))
      .toMatchObject({ amount: 0, amountNeedsReview: true });
  });
});
