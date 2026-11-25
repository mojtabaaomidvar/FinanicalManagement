import { describe, expect, it } from "vitest";
import { isBillOverdue, MAX_BILL_AMOUNT, normalizeBillNumber, parseBillAmount, validateBillInput } from "./bill.rules";
import type { BillInput } from "./bill.types";

const input: BillInput = { kind: "water", title: "Water", amount: "1200.25", dueDate: "2026-11-18" };

describe("bill amounts and identifiers", () => {
  it.each(["", "-1200", "۱۲+۵", "12abc", "12/0", "1e3", "Infinity", "0", "0.001", "10000000000000"])("rejects unsupported or out of range input: %j", raw => {
    expect(parseBillAmount(raw, "تومان")).toBeNull();
  });
  it("groups and converts Persian/Arabic digits without losing stored fractions", () => {
    expect(parseBillAmount("۱٬۲۰۰٫۲۵", "تومان")).toBe("1200.25");
    expect(parseBillAmount("١٢٬٠٠٢٫٥", "ریال")).toBe("1200.25");
    expect(parseBillAmount("1", "ریال")).toBe("0.1");
    expect(parseBillAmount("0.1", "ریال")).toBe("0.01");
    expect(parseBillAmount(MAX_BILL_AMOUNT, "تومان")).toBe(MAX_BILL_AMOUNT);
    expect(parseBillAmount("1.001", "تومان")).toBeNull();
  });
  it("keeps identifiers as text with leading zeroes", () => {
    expect(normalizeBillNumber(" ۰۰۱ ۲٣ ")).toBe("00123");
    expect(normalizeBillNumber("  ")).toBeNull();
    expect(validateBillInput({ ...input, billNo: "12a" })).toBe("number");
    expect(validateBillInput({ ...input, paymentNo: "0".repeat(41) })).toBe("number");
  });
  it.each(["2026-02-30", "2026-13-01", "۱۴۰۵/۰۸/۲۷", "2026-2-03", "invalid"])("rejects invalid dates rather than replacing them: %j", dueDate => {
    expect(validateBillInput({ ...input, dueDate })).toBe("date");
  });
  it("accepts the existing bill contract and protects numeric limits", () => {
    expect(validateBillInput(input)).toBeNull();
    expect(validateBillInput({ ...input, amount: "NaN" })).toBe("amount");
    expect(validateBillInput({ ...input, title: "x".repeat(121) })).toBe("title");
  });
});

describe("bill due dates", () => {
  it("marks only unpaid bills before today as overdue, across unpadded Jalali days and months", () => {
    expect(isBillOverdue({ state: "unpaid", dueDate: "2026-11-09" }, "2026-11-18")).toBe(true);
    expect(isBillOverdue({ state: "unpaid", dueDate: "2026-11-18" }, "2026-11-18")).toBe(false);
    expect(isBillOverdue({ state: "unpaid", dueDate: "2026-11-19" }, "2026-11-18")).toBe(false);
    expect(isBillOverdue({ state: "unpaid", dueDate: "2026-09-30" }, "2026-10-01")).toBe(true);
    expect(isBillOverdue({ state: "paid", dueDate: "2026-11-09" }, "2026-11-18")).toBe(false);
    expect(isBillOverdue({ state: "cancelled", dueDate: "2026-11-09" }, "2026-11-18")).toBe(false);
  });
});
