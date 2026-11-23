import type { AssistantCapabilities, AssistantResult, AssistantScope, FinancialSuggestion } from "@/domain/assistant/assistant.types";
import type { SmsAssistantProposal } from "@/domain/sms/sms.types";

export const assistantScopeForPage = (route: string): AssistantScope =>
  ["dashboard", "transactions", "accounts", "budgets", "reports", "sms"].includes(route) ? "finance"
    : route === "shopping" ? "shopping" : route === "tasks" ? "tasks" : "auto";

export const financialFormProposal = (item: FinancialSuggestion): SmsAssistantProposal => ({
  eventId: item.id, sourceIndex: 0, candidateIndex: 0, candidateTotal: 1,
  rawText: item.source_text, type: item.type, amount: item.amount === null ? null : Number(item.amount),
  amountUnit: item.unit, bank: null, date: item.date, category: item.category ?? "",
  accountId: item.account_id, accountTitle: null, accountMatch: null, confidence: 0,
});

export const assistantDraftKey = (familyId: string, memberId: string) =>
  `khaneyar:household-assistant:v1:${familyId}:${memberId}`;

export function assistantCapabilities(value: unknown): AssistantCapabilities {
  const unavailable: AssistantCapabilities = { status: "unavailable", protocol_version: null, kinds: [] };
  if (!value || typeof value !== "object") return unavailable;
  const result = value as Record<string, unknown>;
  if (result.status === "ready") {
    const kinds = ["transaction", "shopping_item", "task"] as const;
    const reportedKinds = result.kinds;
    return result.protocol_version === 2 && result.contextual === true && result.max_inferences === 2 && Array.isArray(reportedKinds)
      && reportedKinds.length === kinds.length && kinds.every(kind => reportedKinds.includes(kind))
      ? { status: "ready", protocol_version: 2, kinds: [...kinds] }
      : { status: "upgrade_required", protocol_version: null, kinds: [] };
  }
  return ["upgrade_required", "misconfigured", "unavailable"].includes(String(result.status))
    ? { ...unavailable, status: result.status as AssistantCapabilities["status"] } : unavailable;
}

/** Transport types alone cannot validate an outdated or malformed server result. */
export function validAssistantResult(value: unknown): value is AssistantResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const day = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime())
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  const nullable = (value: unknown, check: (value: unknown) => boolean) => value === null || check(value);
  const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max;
  const number = (value: unknown, max: number) => (typeof value === "number" || typeof value === "string")
    && /^\d+(?:\.\d+)?$/.test(String(value)) && Number(value) > 0 && Number(value) <= max;
  if (result.protocol_version !== 1 || !day(result.reference_date) || !Array.isArray(result.proposals)
    || result.proposals.length > 10 || !Array.isArray(result.unsupported) || result.unsupported.length > 20) return false;
  const ids = new Set();
  return result.proposals.every(item => {
    if (!item || typeof item !== "object" || !text(item.id, 128) || !item.id || ids.has(item.id)
      || !text(item.source_text, 24000) || !item.source_text || !Array.isArray(item.warnings)
      || !item.warnings.every((warning: unknown) => ["amount", "unit", "account", "date", "quantity"].includes(String(warning)))) return false;
    ids.add(item.id);
    if (item.kind === "transaction") return ["expense", "income"].includes(item.type)
      && nullable(item.amount, value => number(value, 999999999999)) && [null, "rial", "toman"].includes(item.unit)
      && nullable(item.category, value => text(value, 80)) && nullable(item.account_id, value => text(value, 128))
      && nullable(item.date, day);
    if (item.kind === "shopping_item") return text(item.title, 120) && Boolean(item.title.trim())
      && nullable(item.qty, value => number(value, 99999999)) && nullable(item.unit, value => text(value, 20));
    if (item.kind === "task") return text(item.title, 120) && Boolean(item.title.trim())
      && nullable(item.description, value => text(value, 2000)) && nullable(item.due_date, day);
    return false;
  }) && result.unsupported.every(item => item && typeof item === "object" && text(item.source_text, 24000)
    && ["scope_mismatch", "unsupported_action", "unsupported_question", "manual_field_required", "unsupported_schedule"].includes(item.reason));
}
