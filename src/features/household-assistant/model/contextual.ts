import { HOUSEHOLD_SECTIONS, type ActionReceipt, type ContextResult, type ContextSession, type PreparedAction } from "@/domain/assistant/contextual.types";
import { validAssistantResult } from "./assistant";

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 2000): value is string => typeof value === "string" && value.length <= max;
const uuid = (value: unknown): value is string => text(value, 36) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const list = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
const kinds = ["shopping_list", "shopping_item", "task", "meal_entry"];
const statuses = ["ok", "empty", "limited", "forbidden", "unavailable"];
const foodStatuses = ["available", "missing", "unknown"];
const section = (value: unknown) => HOUSEHOLD_SECTIONS.includes(value as typeof HOUSEHOLD_SECTIONS[number]);
const json = (value: unknown, depth = 0): boolean => depth <= 6 && (value === null
  || text(value) || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)
  || list(value, 40) && value.every(item => json(item, depth + 1))
  || record(value) && Object.keys(value).length <= 40 && Object.values(value).every(item => json(item, depth + 1)));
const rows = (value: unknown): boolean => list(value, 40) && value.every(item => record(item) && json(item));
const day = (value: unknown): value is string => text(value, 10) && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nullableText = (value: unknown, max?: number) => value === null || text(value, max);
const quantity = (value: unknown, zero = false) => (typeof value === "number" || typeof value === "string") && /^\d+(?:\.\d+)?$/.test(String(value)) && Number.isFinite(Number(value)) && (zero ? Number(value) >= 0 : Number(value) > 0);

export function validContextResult(value: unknown): value is ContextResult {
  if (!record(value) || value.protocol_version !== 2 || !uuid(value.report_id) || !text(value.report_token, 64000)
    || !value.report_token || value.inferences !== 1 && value.inferences !== 2
    || !validAssistantResult({ ...value, protocol_version: 1 })
    || !(value.proposals as { kind: string }[]).every(item => item.kind === "transaction")
    || !list(value.sections, 16) || !value.sections.every(item => record(item) && section(item.section)
      && statuses.includes(String(item.status)) && rows(item.rows) && day(item.reference_date) && item.window_days === 31)
    || !list(value.actions, 10) || !list(value.facts, 80) || !list(value.options, 10)
    || !list(value.questions, 5) || !value.questions.every(item => text(item, 400))) return false;
  const actionIds = new Set<string>(), factIds = new Set<string>();
  if (!value.actions.every(item => {
    if (!record(item) || !uuid(item.id) || actionIds.has(item.id) || !kinds.includes(String(item.kind))) return false;
    actionIds.add(item.id);
    if (item.kind === "shopping_list") return nullableText(item.title, 120);
    if (!text(item.title, 120) || !item.title.trim()) return false;
    if (item.kind === "meal_entry") return uuid(item.dish_id) && foodStatuses.includes(String(item.status));
    if (item.kind === "shopping_item") return (item.qty === null || quantity(item.qty)) && nullableText(item.unit, 20)
      && list(item.existing_in ?? [], 40) && (item.existing_in as unknown[] | undefined)?.every(uuid) !== false;
    return nullableText(item.description, 2000) && nullableText(item.due_date, 10);
  })) return false;
  if (!value.facts.every(item => {
    if (!record(item) || !text(item.id, 64) || factIds.has(item.id) || !section(item.section)) return false;
    factIds.add(item.id);
    if (item.kind === "section") return statuses.includes(String(item.status)) && rows(item.rows);
    if (!text(item.title, 2000) || !foodStatuses.includes(String(item.status))) return false;
    if (item.kind === "stock") return rows(item.rows) && typeof item.conflicts_with_request === "boolean";
    return item.kind === "dish" && uuid(item.dish_id) && rows(item.planned) && list(item.ingredients, 40)
      && item.ingredients.every(ingredient => record(ingredient) && text(ingredient.title, 120)
        && quantity(ingredient.qty) && nullableText(ingredient.unit, 20) && foodStatuses.includes(String(ingredient.status))
        && (ingredient.shortage === null || quantity(ingredient.shortage, true))
        && (ingredient.inventory_id === null || uuid(ingredient.inventory_id)));
  })) return false;
  return value.options.every(item => record(item) && text(item.title, 2000) && list(item.action_ids, 10)
    && item.action_ids.every(id => typeof id === "string" && actionIds.has(id)));
}

export function validPreparedAction(value: unknown): value is PreparedAction {
  if (!record(value) || !uuid(value.operation_id) || !kinds.includes(String(value.kind)) || !record(value.summary)
    || !text(value.review_token, 16000) || !value.review_token || value.expires_in !== 900) return false;
  const summary = value.summary;
  if (!text(summary.title, 120) || !summary.title.trim()) return false;
  if (value.kind === "shopping_list") return Object.keys(summary).length === 1;
  if (value.kind === "shopping_item") return uuid(summary.list_id) && text(summary.destination_title, 120)
    && quantity(summary.qty) && Number(summary.qty) <= 99999999 && nullableText(summary.unit, 20);
  if (value.kind === "task") return nullableText(summary.description, 2000)
    && (summary.due_date === null || day(summary.due_date)) && (summary.assignee_id === null || uuid(summary.assignee_id));
  return uuid(summary.dish_id) && day(summary.date) && ["breakfast", "lunch", "dinner"].includes(String(summary.meal_type));
}
export function validActionReceipt(value: unknown): value is ActionReceipt {
  return record(value) && uuid(value.operation_id) && uuid(value.entity_id) && kinds.includes(String(value.kind))
    && ["saved", "existing"].includes(String(value.status)) && typeof value.replayed === "boolean";
}

export function restoredContextSession(value: unknown): ContextSession | null {
  if (!record(value)) return null;
  const result = validContextResult(value.result) ? value.result : null;
  const receipts: Record<string, ActionReceipt> = {};
  if (record(value.receipts) && Object.keys(value.receipts).length <= 10) {
    for (const [id, receipt] of Object.entries(value.receipts)) {
      if (uuid(id) && validActionReceipt(receipt)
        && result?.actions.some(action => action.id === id && action.kind === receipt.kind)) receipts[id] = receipt;
    }
  }
  // A valid outstanding review survives a corrupted/missing report. Losing
  // its operation identity would silently enable a second business write.
  const pending = record(value.pending) && uuid(value.pending.action_id) && validPreparedAction(value.pending.review)
    ? { action_id: value.pending.action_id, review: value.pending.review } : null;
  if (!result && !pending) return null;
  return { result, pending, receipts };
}
