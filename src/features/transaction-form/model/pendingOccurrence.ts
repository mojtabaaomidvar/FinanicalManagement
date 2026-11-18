/** A successful expense whose separate occurrence acknowledgement still needs retry. */
export interface OccurrenceScope {
  familyId: string;
  memberId: string;
  recurringId: string;
  dueDate: string;
}

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function key(scope: OccurrenceScope): string {
  return `khaneyar:pending-occurrence:v1:${scope.familyId}:${scope.memberId}:${scope.recurringId}:${scope.dueDate}`;
}

export function readPendingOccurrence(scope: OccurrenceScope, storage?: ReceiptStorage): string | null {
  try {
    const value = (storage ?? localStorage).getItem(key(scope));
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}

export function rememberPendingOccurrence(scope: OccurrenceScope, transactionId: string, storage?: ReceiptStorage): boolean {
  try {
    (storage ?? localStorage).setItem(key(scope), transactionId);
    return true;
  } catch { return false; }
}

export function clearPendingOccurrence(scope: OccurrenceScope, storage?: ReceiptStorage): void {
  try { (storage ?? localStorage).removeItem(key(scope)); } catch { /* The next fresh read verifies server state. */ }
}
