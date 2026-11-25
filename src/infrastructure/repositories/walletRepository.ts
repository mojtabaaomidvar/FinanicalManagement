import type { WalletBalance, WalletCorrectionReceipt, WalletCorrectionRequest, WalletRepository, WalletScope } from "@/domain/account/wallet.types";
import type { SessionStore } from "@/domain/auth/auth.repository";
import type { ReqOpts, RestClient } from "@/infrastructure/api/restClient";
import { AppError } from "@/shared/lib/appError";
import { compareMoney, normalizeMoney, subtractMoney } from "@/shared/lib/money";

interface BalanceRow {
  account_id: string; revision: number; ledger_balance: string; current_balance: string;
  discrepancy: string; active_reconciliation_id: string | null;
}
interface ReceiptRow {
  id: string; family_id: string; account_id: string; created_by: string; operation_id: string;
  mode: WalletCorrectionReceipt["mode"]; revision: number; target_balance: string;
  ledger_before: string; current_before: string; ledger_after: string; current_after: string;
  delta: string; description: string | null; transaction_id: string | null; created_at: string;
}
const path = (scope: WalletScope) => `/accounts/${encodeURIComponent(scope.accountId)}`;
const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 0;
const invalidResponse = () => new AppError("SERVER", "پاسخ موجودی معتبر نیست؛ اطلاعات را دوباره دریافت کنید.");

function mapBalance(row: BalanceRow, scope: WalletScope): WalletBalance {
  try {
    if (!row || row.account_id !== scope.accountId || !validRevision(row.revision)
      || !(row.active_reconciliation_id === null || typeof row.active_reconciliation_id === "string")) throw invalidResponse();
    const result = {
      accountId: row.account_id, revision: row.revision,
      ledgerBalance: normalizeMoney(row.ledger_balance), currentBalance: normalizeMoney(row.current_balance),
      discrepancy: normalizeMoney(row.discrepancy), activeReconciliationId: row.active_reconciliation_id,
    };
    if (compareMoney(result.discrepancy, subtractMoney(result.currentBalance, result.ledgerBalance)) !== 0
      || (!result.activeReconciliationId && compareMoney(result.discrepancy, "0") !== 0)) throw invalidResponse();
    return result;
  } catch { throw invalidResponse(); }
}

function mapReceipt(row: ReceiptRow, scope: WalletScope): WalletCorrectionReceipt {
  try {
    if (!row || row.family_id !== scope.familyId || row.account_id !== scope.accountId
      || !validRevision(row.revision) || row.revision === 0
      || ![row.id, row.created_by, row.operation_id, row.created_at].every(value => typeof value === "string" && value.length > 0)
      || !["ledger", "reconciliation"].includes(row.mode)
      || !(row.description === null || typeof row.description === "string")
      || !(row.transaction_id === null || typeof row.transaction_id === "string")) throw invalidResponse();
    const result: WalletCorrectionReceipt = {
      id: row.id, familyId: row.family_id, accountId: row.account_id, createdBy: row.created_by,
      operationId: row.operation_id, mode: row.mode, revision: row.revision,
      targetBalance: normalizeMoney(row.target_balance), ledgerBefore: normalizeMoney(row.ledger_before),
      currentBefore: normalizeMoney(row.current_before), ledgerAfter: normalizeMoney(row.ledger_after),
      currentAfter: normalizeMoney(row.current_after), delta: normalizeMoney(row.delta),
      description: row.description, transactionId: row.transaction_id, createdAt: row.created_at,
    };
    if (compareMoney(result.currentAfter, result.targetBalance) !== 0
      || compareMoney(result.delta, subtractMoney(result.targetBalance, result.mode === "ledger" ? result.ledgerBefore : result.currentBefore)) !== 0
      || compareMoney(result.ledgerAfter, result.mode === "ledger" ? result.targetBalance : result.ledgerBefore) !== 0
      || (result.mode === "reconciliation" && result.transactionId !== null)
      || (result.mode === "ledger" && (compareMoney(result.delta, "0") === 0) !== (result.transactionId === null))) throw invalidResponse();
    return result;
  } catch { throw invalidResponse(); }
}

/** Pin the token belonging to this scope before awaiting an HTTP request. */
export class RestWalletRepository implements WalletRepository {
  constructor(private readonly client: RestClient, private readonly session: SessionStore) {}
  private async options(scope: WalletScope): Promise<ReqOpts> {
    const session = await this.session.load();
    if (!session?.token || session.family.id !== scope.familyId || session.member.id !== scope.memberId
      || session.member.familyId !== scope.familyId) {
      throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحهٔ کیف پول را دوباره باز کنید.");
    }
    return { bearer: session.token, cache: "no-store" };
  }
  async balance(scope: WalletScope) {
    return mapBalance(await this.client.get<BalanceRow>(`${path(scope)}/balance`, await this.options(scope)), scope);
  }
  async history(scope: WalletScope) {
    const rows = await this.client.get<ReceiptRow[]>(`${path(scope)}/corrections`, await this.options(scope));
    if (!Array.isArray(rows)) throw invalidResponse();
    return rows.map(row => mapReceipt(row, scope));
  }
  async correct(scope: WalletScope, request: WalletCorrectionRequest) {
    const row = await this.client.post<ReceiptRow>(`${path(scope)}/corrections`, {
      operation_id: request.operationId, base_revision: request.baseRevision,
      target_balance: request.targetBalance, mode: request.mode, description: request.description,
    }, await this.options(scope));
    return this.ownReceipt(row, scope, request.operationId);
  }
  async receipt(scope: WalletScope, operationId: string) {
    const row = await this.client.get<ReceiptRow>(`${path(scope)}/corrections/${encodeURIComponent(operationId)}`, await this.options(scope));
    return this.ownReceipt(row, scope, operationId);
  }
  private ownReceipt(row: ReceiptRow, scope: WalletScope, operationId: string) {
    const result = mapReceipt(row, scope);
    if (result.createdBy !== scope.memberId || result.operationId !== operationId) throw invalidResponse();
    return result;
  }
}
