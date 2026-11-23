import type { AssistantResult } from "./assistant.types";

export const HOUSEHOLD_SECTIONS = ["inventory", "shopping", "meals", "tasks", "events", "equipment",
  "vehicles", "bills", "finance", "goals", "activities", "children", "pets", "documents", "holdings", "market"] as const;
export type HouseholdSection = typeof HOUSEHOLD_SECTIONS[number];
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ContextRow = Record<string, JsonValue>;
export type ContextStatus = "ok" | "empty" | "limited" | "forbidden" | "unavailable";
export interface ContextSection {
  section: HouseholdSection; status: ContextStatus; rows: ContextRow[];
  reference_date: string; window_days: number;
}
export interface IngredientFinding {
  title: string; qty: string | number; unit: string | null;
  status: "available" | "missing" | "unknown"; shortage: string | null; inventory_id: string | null;
}
export type ContextFact = {
  id: string; kind: "stock"; title: string; section: "inventory";
  status: "available" | "missing" | "unknown"; rows: ContextRow[]; conflicts_with_request: boolean;
} | {
  id: string; kind: "dish"; title: string; section: "meals"; dish_id: string;
  status: "available" | "missing" | "unknown"; ingredients: IngredientFinding[]; planned: ContextRow[];
} | {
  id: string; kind: "section"; section: HouseholdSection; status: ContextStatus; rows: ContextRow[];
};
export interface ContextAction {
  id: string; kind: "shopping_list" | "shopping_item" | "task" | "meal_entry";
  title: string | null; qty?: string | number | null; unit?: string | null;
  description?: string | null; due_date?: string | null; dish_id?: string;
  existing_in?: string[]; source_fact?: string; status?: "available" | "missing" | "unknown";
}
export interface ContextResult extends AssistantResult {
  protocol_version: 2; report_id: string; report_token: string;
  sections: ContextSection[]; facts: ContextFact[]; actions: ContextAction[];
  options: { title: string; action_ids: string[] }[]; questions: string[]; inferences: 1 | 2;
}
export interface PrepareActionFields {
  list_id?: string; title?: string; qty?: number; unit?: string | null;
  assignee_id?: string | null; due_date?: string | null; meal_type?: "breakfast" | "lunch" | "dinner";
}
export interface PreparedAction {
  operation_id: string; kind: ContextAction["kind"]; summary: ContextRow;
  review_token: string; expires_in: number;
}
export interface ActionReceipt {
  operation_id: string; kind: ContextAction["kind"]; status: "saved" | "existing";
  entity_id: string; replayed: boolean;
}
export interface PendingAction { action_id: string; review: PreparedAction }
export interface ContextSession {
  result: ContextResult | null; pending: PendingAction | null;
  receipts: Record<string, ActionReceipt>;
}
export interface ContextRepository {
  report(text: string): Promise<ContextResult>;
  prepare(reportToken: string, actionId: string, fields: PrepareActionFields): Promise<PreparedAction>;
  execute(reviewToken: string): Promise<ActionReceipt>;
  receipt(operationId: string): Promise<ActionReceipt>;
}
