import { describe, expect, it } from "vitest";
import type { Transaction } from "./transaction.types";
import { nextPendingOccurrence, recurringTemplate, transactionDueOccurrences } from "./recurring.rules";
import { isoToJalali } from "@/shared/lib/jalali";
const tx: Transaction = { id: "source", familyId: "family", memberId: "self", type: "expense",
  amount: "1000", category: "food", date: "2026-11-01", time: null, note: "Original",
  accountId: "cash", toAccountId: null, subcategoryId: "food-label", repeat: "weekly",
  repeatEnd: "2026-12-31", handledOccurrences: [], photos: [], createdAt: "2026-11-01" };

describe("future recurring plans", () => {
  it("projects future values without mutating the actual transaction or retaining a mismatched label", () => {
    const edited = { ...tx, recurringPlan: { amount: "2000", category: "home", note: "Future", startDate: "2026-11-26", revision: 1 } };
    expect(recurringTemplate(edited)).toMatchObject({ amount: "2000", category: "home", note: "Future", subcategoryId: null });
    expect(edited).toMatchObject({ amount: "1000", category: "food", note: "Original", subcategoryId: "food-label" });
    expect(recurringTemplate({ ...edited, recurringPlan: { ...edited.recurringPlan, category: "food", note: "" } }).note).toBe("");
  });
  it("includes the explicit new next date and skips settled dates while supporting early payment", () => {
    const edited = { ...tx, handledOccurrences: ["2026-11-26"], recurringPlan: { amount: "2000", category: "food", note: null, startDate: "2026-11-26", revision: 1 } };
    expect(transactionDueOccurrences(edited, isoToJalali("2026-12-03"))).toEqual(["2026-11-26", "2026-12-03"]);
    expect(nextPendingOccurrence(edited)).toBe("2026-12-03");
    expect(nextPendingOccurrence(tx)).toBe("2026-11-08");
    expect(nextPendingOccurrence({ ...edited, repeat: "none" })).toBeNull();
  });
});
