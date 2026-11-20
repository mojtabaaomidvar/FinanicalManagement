import type { SmsReceiptScope } from "./pendingSmsReceipt";
import type { TransferFeeMethod } from "@/domain/transaction/transaction.types";

export interface SmsDraftScope { familyId: string; memberId: string }
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PendingSmsDraft {
  type: "expense" | "income"; categoryId: string; amount: string; currency: string;
  date: string; accountId: string; label: string;
  feeChoice?: "" | "yes" | "no";
  feeMethod?: "" | TransferFeeMethod;
}
function key(scope: SmsDraftScope, smsId?: string): string {
  return `khaneyar:sms-draft:v1:${scope.familyId}:${scope.memberId}:${smsId ?? "import"}`;
}
export function readImportDraft(scope: SmsDraftScope, storage?: DraftStorage): string {
  try { return (storage ?? localStorage).getItem(key(scope)) ?? ""; } catch { return ""; }
}
export function rememberImportDraft(scope: SmsDraftScope, raw: string, storage?: DraftStorage): boolean {
  try {
    if (raw) (storage ?? localStorage).setItem(key(scope), raw);
    else (storage ?? localStorage).removeItem(key(scope));
    return true;
  } catch { return false; }
}
export function readPendingDraft(scope: SmsReceiptScope, storage?: DraftStorage): PendingSmsDraft | null {
  try {
    const raw = (storage ?? localStorage).getItem(key(scope, scope.smsId));
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (!draft || typeof draft !== "object") return null;
    const value = draft as Record<string, unknown>;
    if (!["expense", "income"].includes(String(value.type))
      || !["categoryId", "amount", "currency", "date", "accountId", "label"].every(field => typeof value[field] === "string")) return null;
    if (value.feeChoice !== undefined && (typeof value.feeChoice !== "string" || !["", "yes", "no"].includes(value.feeChoice))) return null;
    if (value.feeMethod !== undefined && (typeof value.feeMethod !== "string" || !["", "internal", "card_to_card", "paya", "satna", "pol"].includes(value.feeMethod))) return null;
    return value as unknown as PendingSmsDraft;
  } catch { return null; }
}
export function rememberPendingDraft(scope: SmsReceiptScope, draft: PendingSmsDraft, storage?: DraftStorage): boolean {
  try { (storage ?? localStorage).setItem(key(scope, scope.smsId), JSON.stringify(draft)); return true; }
  catch { return false; }
}
export function clearPendingDraft(scope: SmsReceiptScope, storage?: DraftStorage): void {
  try { (storage ?? localStorage).removeItem(key(scope, scope.smsId)); } catch { /* The server message remains authoritative. */ }
}
