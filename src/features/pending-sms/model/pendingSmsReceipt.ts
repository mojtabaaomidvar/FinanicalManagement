export interface SmsReceiptScope {
  familyId: string;
  memberId: string;
  smsId: string;
}

type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function key(scope: SmsReceiptScope): string {
  return `khaneyar:pending-sms:v1:${scope.familyId}:${scope.memberId}:${scope.smsId}`;
}
export function readSmsReceipt(scope: SmsReceiptScope, storage?: ReceiptStorage): string | null {
  try {
    const value = (storage ?? localStorage).getItem(key(scope));
    return value && UUID.test(value) ? value : null;
  } catch { return null; }
}
export function rememberSmsReceipt(scope: SmsReceiptScope, transactionId: string, storage?: ReceiptStorage): boolean {
  try { (storage ?? localStorage).setItem(key(scope), transactionId); return true; }
  catch { return false; }
}
export function clearSmsReceipt(scope: SmsReceiptScope, storage?: ReceiptStorage): void {
  try { (storage ?? localStorage).removeItem(key(scope)); } catch { /* Verify current server state before retry. */ }
}
