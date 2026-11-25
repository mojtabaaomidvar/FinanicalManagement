import { formatMoney, parseMoneyInput } from "./money";

/** Convert display only. Invalid/incomplete drafts are never rewritten. */
export function convertMoneyDraft(raw: string, from: string, to: string): string | null {
  if (!raw.trim() || from === to) return raw;
  const value = parseMoneyInput(raw, from);
  return value === null ? null : formatMoney(value, to);
}
