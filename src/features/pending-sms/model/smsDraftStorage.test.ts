import { describe, expect, it } from "vitest";
import { readImportDraft, rememberImportDraft, readPendingDraft, rememberPendingDraft, clearPendingDraft } from "./smsDraftStorage";

const scope = { familyId: "family-a", memberId: "member-a", smsId: "sms-a" };
function storage() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } };
}
describe("unfinished SMS drafts", () => {
  it("restores pasted text without mixing family or member identities", () => {
    const store = storage(), text = "بانک ملی\nبرداشت ۱۰۰۰ ریال";
    expect(rememberImportDraft(scope, text, store)).toBe(true);
    expect(readImportDraft(scope, store)).toBe(text);
    expect(readImportDraft({ ...scope, memberId: "member-b" }, store)).toBe("");
    expect(readImportDraft({ ...scope, familyId: "family-b" }, store)).toBe("");
    rememberImportDraft(scope, "", store);
    expect(readImportDraft(scope, store)).toBe("");
  });
  it("retains review fields independently per message and clears only the finished message", () => {
    const store = storage(), draft = { type: "income" as const, amount: "۱۲,۵۰۰", currency: "تومان",
      categoryId: "salary", date: "۱۴۰۵/۰۸/۲۸", accountId: "own-account", label: "حقوق" };
    rememberPendingDraft(scope, draft, store);
    rememberPendingDraft({ ...scope, smsId: "sms-b" }, { ...draft, label: "دیگر" }, store);
    expect(readPendingDraft(scope, store)).toEqual(draft);
    expect(readPendingDraft({ ...scope, memberId: "member-b" }, store)).toBeNull();
    clearPendingDraft(scope, store);
    expect(readPendingDraft(scope, store)).toBeNull();
    expect(readPendingDraft({ ...scope, smsId: "sms-b" }, store)?.label).toBe("دیگر");
  });
  it("fails predictably when storage is unavailable", () => {
    const store = { getItem: () => { throw Error("unavailable"); }, setItem: () => { throw Error("unavailable"); }, removeItem: () => {} };
    expect(readImportDraft(scope, store)).toBe("");
    expect(rememberImportDraft(scope, "SMS", store)).toBe(false);
    expect(readPendingDraft(scope, store)).toBeNull();
  });
});
