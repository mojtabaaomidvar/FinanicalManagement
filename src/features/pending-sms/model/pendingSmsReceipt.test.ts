import { describe, expect, it } from "vitest";
import { clearSmsReceipt, readSmsReceipt, rememberSmsReceipt } from "./pendingSmsReceipt";
const scope = { familyId: "family", memberId: "member", smsId: "message" };
const transactionId = "cf000000-0000-4000-8000-000000000999";
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
}
describe("SMS recovery identity", () => {
  it("stores only the known financial ID and clears only its own key", () => {
    const storage = memory(); storage.setItem("manual-data", "keep");
    expect(rememberSmsReceipt(scope, transactionId, storage)).toBe(true);
    expect(readSmsReceipt(scope, storage)).toBe(transactionId);
    clearSmsReceipt(scope, storage);
    expect(readSmsReceipt(scope, storage)).toBeNull();
    expect(storage.getItem("manual-data")).toBe("keep");
  });
  it.each([{ familyId: "other" }, { memberId: "other" }, { smsId: "other" }])("isolates identities: %j", difference => {
    const storage = memory(); rememberSmsReceipt(scope, transactionId, storage);
    expect(readSmsReceipt({ ...scope, ...difference }, storage)).toBeNull();
  });
  it("reports unavailable storage and ignores malformed identities", () => {
    const unavailable = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } };
    expect(rememberSmsReceipt(scope, transactionId, unavailable)).toBe(false);
    expect(readSmsReceipt(scope, unavailable)).toBeNull();
    const storage = memory(); rememberSmsReceipt(scope, "invalid", storage);
    expect(readSmsReceipt(scope, storage)).toBeNull();
  });
});
