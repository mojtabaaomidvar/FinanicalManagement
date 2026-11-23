import { describe, expect, it } from "vitest";
import type { Account } from "@/domain/account/account.types";
import type { SmsAssistantProposal } from "@/domain/sms/sms.types";
import type { TxFormState } from "./useTxFormModel";
import { assistantFormDraft, assistantDraftKey, assistantDate, clearSavedAssistantDraft } from "./transactionAssistant";

const form: TxFormState = {
  type: "expense", amount: "", categoryId: "", date: "۱۴۰۵/۰۹/۰۱", time: "12:00",
  memberId: "self", note: "", accountId: "mine", toAccountId: "", feeChoice: "yes",
  feeMethod: "card_to_card", label: "", repeat: "none", repeatEnd: "",
};
const accounts = [{ id: "mine", memberId: "self" }, { id: "foreign", memberId: "other" }] as Account[];
const proposal: SmsAssistantProposal = {
  eventId: "event", sourceIndex: 0, candidateIndex: 0, candidateTotal: 1,
  rawText: "امروز ۲۵۰ هزار تومان برای میوه خرج کردم.", type: "expense", amount: 250000,
  amountUnit: "toman", date: null, category: "food", bank: null, accountId: null,
  accountTitle: null, accountMatch: null, confidence: 0.9,
};

describe("assistant to transaction form", () => {
  it("prepares a draft only and preserves the original narrative", () => {
    const draft = assistantFormDraft(proposal, form, "ریال", accounts, "2026-11-22");
    expect(draft.entryCurrency).toBe("تومان");
    expect(draft.form.amount).toBe("۲۵۰,۰۰۰");
    expect(draft.form.categoryId).toBe("food");
    expect(draft.form.accountId).toBe("mine");
    expect(draft.form.note).toBe(proposal.rawText);
    expect(form.amount).toBe("");
  });
  it("copies rial values without an accidental factor-of-ten conversion", () => {
    const draft = assistantFormDraft({ ...proposal, amount: 10000, amountUnit: "rial" }, form, "تومان", accounts);
    expect(draft.entryCurrency).toBe("ریال");
    expect(draft.form.amount).toBe("۱۰,۰۰۰");
  });
  it.each([null, NaN, Infinity, -1, 0])("never fills an invalid amount (%s)", amount => {
    expect(assistantFormDraft({ ...proposal, amount }, form, "تومان", accounts).form.amount).toBe("");
  });
  it("does not guess an unknown currency or silently retain a previous amount", () => {
    const draft = assistantFormDraft({ ...proposal, amountUnit: null }, { ...form, amount: "9000" }, "ریال", accounts);
    expect(draft.form.amount).toBe("");
    expect(draft.entryCurrency).toBe("ریال");
  });
  it("never chooses a foreign account or promotes a bank-name-only suggestion", () => {
    expect(assistantFormDraft({ ...proposal, accountId: "foreign" }, { ...form, accountId: "" }, "تومان", accounts).form.accountId).toBe("");
    expect(assistantFormDraft({ ...proposal, accountTitle: "mine", accountMatch: "unique_bank" }, { ...form, accountId: "" }, "تومان", accounts).form.accountId).toBe("");
  });
  it("preserves handwritten notes and recurrence, clearing incompatible fees and labels", () => {
    const draft = assistantFormDraft({ ...proposal, type: "income", category: "salary" },
      { ...form, note: "یادداشت خودم", label: "میوه", repeat: "monthly" }, "تومان", accounts);
    expect(draft.form.note).toBe("یادداشت خودم");
    expect(draft.form.repeat).toBe("monthly");
    expect(draft.form.feeChoice).toBe("");
    expect(draft.form.feeMethod).toBe("");
    expect(draft.form.label).toBe("");
  });
  it("resolves relative days locally rather than trusting a model's guessed date", () => {
    expect(assistantDate("امروز خرید کردم", "2026-01-20", "2026-11-22")).toBe("2026-11-22");
    expect(assistantDate("دیروز خرید کردم", null, "2026-11-22")).toBe("2026-11-21");
    expect(assistantDate("پریروز خرید کردم", null, "2026-11-22")).toBe("2026-11-20");
    expect(assistantDate("دیروز و امروز خرید کردم", "2026-01-20", "2026-11-22")).toBeNull();
    expect(assistantDate("خرید کردم", "2026-02-30", "2026-11-22")).toBeNull();
    expect(assistantDate("خرید کردم", "2026-01-20", "2026-11-22")).toBeNull();
    expect(assistantDate("خرید ۱۴۰۵/۰۹/۰۱", "2026-01-20", "2026-11-22")).toBe("2026-11-22");
    expect(assistantDate("خرید 2026-02-30", "2026-02-28", "2026-11-22")).toBeNull();
    expect(assistantDate("خرید ۱۴۰۵/۱۲/۳۰", null, "2026-11-22")).toBeNull();
    expect(assistantDate("خرید 2026-11-20 و 2026-11-21", "2026-11-20", "2026-11-22")).toBeNull();
  });
  it("scopes its draft separately from the SMS inbox and from other members", () => {
    expect(assistantDraftKey("home", "self")).not.toBe(assistantDraftKey("home", "peer"));
    expect(assistantDraftKey("home", "self")).not.toContain("sms-draft");
  });
  it("clears only the matching source after a successful save, never a newer draft", () => {
    const data = new Map([["draft", "old"]]);
    const storage = { getItem: (key: string) => data.get(key) ?? null, removeItem: (key: string) => { data.delete(key); } };
    clearSavedAssistantDraft({ key: "draft", raw: "different" }, storage);
    expect(data.get("draft")).toBe("old");
    clearSavedAssistantDraft({ key: "draft", raw: "old" }, storage);
    expect(data.has("draft")).toBe(false);
  });
});
