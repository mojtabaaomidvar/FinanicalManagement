export type AssistantScope = "auto" | "finance" | "shopping" | "tasks";
export type AssistantKind = "transaction" | "shopping_item" | "task";
export interface AssistantCapabilities {
  status: "ready" | "upgrade_required" | "unavailable" | "misconfigured";
  protocol_version: number | null;
  kinds: AssistantKind[];
}
interface Evidence { id: string; source_text: string; warnings: string[] }
export interface FinancialSuggestion extends Evidence {
  kind: "transaction"; type: "expense" | "income"; amount: string | number | null;
  unit: "rial" | "toman" | null; category: string | null; account_id: string | null; date: string | null;
}
export interface ShoppingSuggestion extends Evidence {
  kind: "shopping_item"; title: string; qty: string | number | null; unit: string | null;
}
export interface TaskSuggestion extends Evidence {
  kind: "task"; title: string; description: string | null; due_date: string | null;
}
export type AssistantSuggestion = FinancialSuggestion | ShoppingSuggestion | TaskSuggestion;
export type UnsupportedReason = "scope_mismatch" | "unsupported_action" | "unsupported_question"
  | "manual_field_required" | "unsupported_schedule";
export interface AssistantResult {
  protocol_version: number; reference_date: string; proposals: AssistantSuggestion[];
  unsupported: { source_text: string; reason: UnsupportedReason }[];
}
export interface AssistantRepository {
  capabilities(): Promise<AssistantCapabilities>;
  analyze(text: string, scope: AssistantScope): Promise<AssistantResult>;
}
export interface AssistantReview<T extends AssistantSuggestion> {
  proposal: T; referenceDate: string; listId?: string;
}
export type AssistantOutcome = "queued" | "saved";
