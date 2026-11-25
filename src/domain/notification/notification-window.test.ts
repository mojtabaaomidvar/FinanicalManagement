import { describe, expect, it } from "vitest";
import { addDays, isoToJalali, jalaliToIso } from "@/shared/lib/jalali";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Bill } from "@/domain/bill/bill.types";
import type { FamilyEvent } from "@/domain/event/event.types";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";

function input(todayIso: string): DeriveInput {
  const todayJ = isoToJalali(todayIso), date = (offset: number) => jalaliToIso(addDays(todayJ, offset));
  return {
    todayJ, role: "owner", memberId: "member", dismissed: new Set(),
    prefs: { ...DEFAULT_NOTIFICATION_PREFS, leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays,
      recurring: 60, bills: 0, event: Number.NaN } },
    inventory: [], shoppingLists: [], joinRequests: [],
    txs: [-1, 0, 1, 2].map((offset): Transaction => ({
      id: String(offset), familyId: "family", memberId: "member", type: "expense", amount: "1500.25",
      category: "bills", accountId: "account", toAccountId: null, subcategoryId: null,
      date: date(offset - 28), repeat: "weekly", repeatEnd: date(30), handledOccurrences: [],
      photos: [], time: null, note: "Keep user content", createdAt: "2026-11-01T00:00:00Z",
    })),
    bills: [-1, 0, 1, 2].map((offset): Bill => ({
      id: String(offset), kind: "electricity", title: "Keep bill", amount: "2000", dueDate: date(offset),
      billNo: null, paymentNo: null, state: "unpaid", paidAt: null, paidByMemberId: null,
      transactionId: null, note: null, createdBy: "member", createdAt: "2026-11-01T00:00:00Z",
    })),
    events: [-1, 0, 1, 2].map((offset): FamilyEvent => ({
      id: String(offset), familyId: "family", memberId: "member", forMemberId: null,
      title: "Keep occasion", date: date(offset), note: null, createdAt: "2026-11-01T00:00:00Z",
    })),
  };
}

describe("shared dated reminder window", () => {
  it.each(["2026-11-30", "2026-12-31", "2027-03-20"])("uses today and tomorrow across calendar boundaries: %s", day => {
    const data = input(day), before = structuredClone(data);
    const tomorrow = jalaliToIso(addDays(data.todayJ, 1));
    const notes = deriveNotifications(data);
    expect(notes).toHaveLength(6);
    for (const [date, severity] of [[day, "pending"], [tomorrow, "soon"]]) {
      const dated = notes.filter(note => note.dateIso === date);
      expect(dated.map(note => note.domain).sort()).toEqual(["bills", "event", "recurring"]);
      expect(dated.every(note => note.severity === severity)).toBe(true);
    }
    expect(data).toEqual(before);
  });
  it("keeps handled and stopped occurrences out and respects current manager permissions", () => {
    const data = input("2026-11-18");
    for (const role of ["owner", "admin"] as const) {
      expect(deriveNotifications({ ...data, role }).filter(note => note.domain === "recurring")).toHaveLength(2);
    }
    expect(deriveNotifications({ ...data, role: "member" }).filter(note => note.domain === "recurring")).toEqual([]);
    data.txs[1].handledOccurrences = ["2026-11-18"];
    data.txs[2].repeat = "none";
    expect(deriveNotifications(data).filter(note => note.domain === "recurring")).toEqual([]);
    expect(deriveNotifications({ ...data, prefs: { ...data.prefs, enabled: false } })).toEqual([]);
  });
});
