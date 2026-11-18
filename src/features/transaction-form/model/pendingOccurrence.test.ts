import { describe, expect, it } from "vitest";
import { clearPendingOccurrence, readPendingOccurrence, rememberPendingOccurrence, type OccurrenceScope } from "./pendingOccurrence";

const scope: OccurrenceScope = { familyId: "family", memberId: "member", recurringId: "recurring", dueDate: "2026-11-18" };
const transactionId = "cf000000-0000-4000-8000-000000000999";
function memory() {
  const rows = new Map<string, string>();
  return { rows, getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
describe("pending occurrence receipts", () => {
  it("retains a successful expense identity for reopening without creating another expense", () => {
    const storage = memory();
    expect(rememberPendingOccurrence(scope, transactionId, storage)).toBe(true);
    expect(readPendingOccurrence(scope, storage)).toBe(transactionId);
    expect([...storage.rows.values()]).toEqual([transactionId]);
  });
  it.each([{ familyId: "other" }, { memberId: "other" }, { recurringId: "other" }, { dueDate: "2026-12-18" }])("isolates receipts by family member schedule and date: %j", difference => {
    const storage = memory(); rememberPendingOccurrence(scope, transactionId, storage);
    expect(readPendingOccurrence({ ...scope, ...difference }, storage)).toBeNull();
    clearPendingOccurrence({ ...scope, ...difference }, storage);
    expect(readPendingOccurrence(scope, storage)).toBe(transactionId);
  });
  it("clears only the acknowledged receipt and preserves other local data", () => {
    const storage = memory(); storage.setItem("manual-data", "keep");
    rememberPendingOccurrence(scope, transactionId, storage);
    clearPendingOccurrence(scope, storage);
    expect(readPendingOccurrence(scope, storage)).toBeNull(); expect(storage.getItem("manual-data")).toBe("keep");
  });
  it("reports unavailable storage and rejects malformed persisted identities", () => {
    const unavailable = { getItem: () => { throw new Error("unavailable"); }, setItem: () => { throw new Error("unavailable"); }, removeItem: () => { throw new Error("unavailable"); } };
    expect(rememberPendingOccurrence(scope, transactionId, unavailable)).toBe(false);
    expect(readPendingOccurrence(scope, unavailable)).toBeNull(); expect(() => clearPendingOccurrence(scope, unavailable)).not.toThrow();
    const storage = memory(); rememberPendingOccurrence(scope, "not-an-id", storage);
    expect(readPendingOccurrence(scope, storage)).toBeNull();
  });
});
