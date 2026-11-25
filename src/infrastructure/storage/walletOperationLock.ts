/** The same lock spans encrypted staging, transmission and outcome cleanup in all tabs. */
const localLocks = new Map<string, Promise<unknown>>();
export function canCoordinateWalletOperations(): boolean {
  return typeof window === "undefined" || (typeof navigator !== "undefined" && Boolean(navigator.locks));
}
export async function withWalletOperationLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const name = `khaneyar-wallet-operation:${key}`;
  if (typeof navigator !== "undefined" && navigator.locks) return navigator.locks.request(name, work);
  // Only used outside a browser. Unsupported browsers cannot stage a new write.
  const result = (localLocks.get(name) ?? Promise.resolve()).then(work, work);
  const settled = result.catch(() => undefined);
  localLocks.set(name, settled);
  try { return await result; }
  finally { if (localLocks.get(name) === settled) localLocks.delete(name); }
}
