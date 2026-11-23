import type { Account } from "@/domain/account/account.types";
import type { SmsAssistantProposal } from "@/domain/sms/sms.types";
import { categoriesFor } from "@/domain/category/category.catalog";
import { formatISO, isoToJalali, jalaliToIso, today } from "@/shared/lib/jalali";
import { formatExpressionValue } from "@/shared/ui/CalcKeypad";
import { extractDate } from "@/shared/lib/sms-parser";
import { toEn } from "@/shared/lib/digits";
import type { TxFormState } from "./useTxFormModel";

export function assistantDraftKey(familyId: string, memberId: string): string {
  return `khaneyar:transaction-assistant:v1:${familyId}:${memberId}`;
}

export function clearSavedAssistantDraft(
  source: { key: string; raw: string } | null, storage?: Pick<Storage, "getItem" | "removeItem">,
): void {
  if (!source) return;
  try {
    const target = storage ?? localStorage;
    if (target.getItem(source.key) === source.raw) target.removeItem(source.key);
  } catch { /* An unavailable browser store must not invalidate a saved transaction. */ }
}

// Model dates are not evidence: resolve relative and explicit numeric dates locally.
export function assistantDate(raw: string, _proposed: string | null, current = jalaliToIso(today())): string | null {
  const relative = [...new Set(raw.match(/پریروز|دیروز|امروز/g) ?? [])];
  if (relative.length > 1) return null;
  if (relative.length === 1) {
    const date = new Date(`${current}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - ({ امروز: 0, دیروز: 1, پریروز: 2 }[relative[0]] ?? 0));
    return date.toISOString().slice(0, 10);
  }
  const explicit = [...new Set(toEn(raw).match(/(?:1[34]\d{2}|20\d{2})[\/.-]\d{1,2}[\/.-]\d{1,2}|\d{1,2}[\/.-]\d{1,2}[\/.-]20\d{2}/g) ?? [])];
  if (explicit.length !== 1) return null;
  try {
    const parsed = extractDate(explicit[0]);
    if (!parsed) return null;
    const iso = `${parsed.gy}-${String(parsed.gm).padStart(2, "0")}-${String(parsed.gd).padStart(2, "0")}`;
    const date = new Date(`${iso}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
    if (isoToJalali(iso).some((value, index) => value !== parsed.jalali[index])) return null;
    return iso;
  } catch { return null; }
}

/** No API writes: the ordinary form remains responsible for validation and saving. */
export function assistantFormDraft(
  proposal: SmsAssistantProposal, previous: TxFormState, currency: string, accounts: Account[], current?: string,
): { form: TxFormState; entryCurrency: string } {
  const knownAmount = proposal.amount !== null && Number.isFinite(proposal.amount)
    && proposal.amount > 0 && proposal.amount <= 999_999_999_999
    && (proposal.amountUnit === "rial" || proposal.amountUnit === "toman");
  const category = categoriesFor(proposal.type).find(item => item.id === proposal.category)?.id ?? "";
  const owns = (id: string | null) => accounts.some(account => account.id === id && account.memberId === previous.memberId);
  const date = assistantDate(proposal.rawText, proposal.date, current);
  const changedType = previous.type !== proposal.type;
  return {
    entryCurrency: knownAmount ? proposal.amountUnit === "rial" ? "ریال" : "تومان" : currency,
    form: {
      ...previous, type: proposal.type,
      amount: knownAmount ? formatExpressionValue(proposal.amount!) : "",
      categoryId: category, date: date ? formatISO(isoToJalali(date)) : previous.date,
      accountId: owns(proposal.accountId) ? proposal.accountId! : owns(previous.accountId) ? previous.accountId : "",
      toAccountId: "", note: previous.note || proposal.rawText.slice(0, 200),
      label: changedType || category !== previous.categoryId ? "" : previous.label,
      feeChoice: changedType ? "" : previous.feeChoice,
      feeMethod: changedType ? "" : previous.feeMethod,
    },
  };
}
