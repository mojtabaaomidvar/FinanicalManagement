import type { Money } from "@/shared/lib/money";

/** The authenticated reader and the fixed account, never a display filter. */
export interface WalletScope { familyId: string; memberId: string; accountId: string }
export type WalletCorrectionMode = "ledger" | "reconciliation";
export interface WalletBalance {
  accountId: string;
  revision: number;
  ledgerBalance: Money;
  currentBalance: Money;
  discrepancy: Money;
  activeReconciliationId: string | null;
}
export interface WalletCorrectionReview {
  baseRevision: number;
  targetBalance: Money;
  mode: WalletCorrectionMode;
  description: string | null;
}
export interface WalletCorrectionRequest extends WalletCorrectionReview { operationId: string }
export interface WalletCorrectionReceipt {
  id: string;
  familyId: string;
  accountId: string;
  createdBy: string;
  operationId: string;
  mode: WalletCorrectionMode;
  revision: number;
  targetBalance: Money;
  ledgerBefore: Money;
  currentBefore: Money;
  ledgerAfter: Money;
  currentAfter: Money;
  delta: Money;
  description: string | null;
  transactionId: string | null;
  createdAt: string;
}
export interface PendingWalletCorrection {
  version: 1;
  scope: WalletScope;
  request: WalletCorrectionRequest;
}
export interface WalletRepository {
  balance(scope: WalletScope): Promise<WalletBalance>;
  history(scope: WalletScope): Promise<WalletCorrectionReceipt[]>;
  correct(scope: WalletScope, request: WalletCorrectionRequest): Promise<WalletCorrectionReceipt>;
  receipt(scope: WalletScope, operationId: string): Promise<WalletCorrectionReceipt>;
}
