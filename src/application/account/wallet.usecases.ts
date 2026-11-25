import type {
  PendingWalletCorrection, WalletCorrectionReceipt, WalletCorrectionRequest, WalletCorrectionReview,
  WalletRepository, WalletScope,
} from "@/domain/account/wallet.types";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { canCoordinateWalletOperations, withWalletOperationLock } from "@/infrastructure/storage/walletOperationLock";
import { AppError, isAppError } from "@/shared/lib/appError";
import { moneyFits, normalizeMoney } from "@/shared/lib/money";

const keyFor = (scope: WalletScope) => `wallet-correction:${JSON.stringify([scope.familyId, scope.memberId, scope.accountId])}`;
const sameScope = (left: WalletScope, right: WalletScope) => left.familyId === right.familyId && left.memberId === right.memberId && left.accountId === right.accountId;
const sameRequest = (left: WalletCorrectionReview, right: WalletCorrectionReview) => left.baseRevision === right.baseRevision
  && left.targetBalance === right.targetBalance && left.mode === right.mode && left.description === right.description;

function validateReview(review: WalletCorrectionReview): WalletCorrectionReview {
  if (!review || !Number.isSafeInteger(review.baseRevision) || review.baseRevision < 0
    || !["ledger", "reconciliation"].includes(review.mode)
    || !(review.description === null || (typeof review.description === "string" && review.description.length <= 200))
    || !moneyFits(review.targetBalance, { scale: 2, min: "-999999999999999", max: "999999999999999" })) {
    throw new AppError("INVALID_ACCOUNT", "اطلاعات اصلاح موجودی معتبر نیست؛ مبلغ و روش ثبت را بررسی کنید.");
  }
  return { baseRevision: review.baseRevision, targetBalance: normalizeMoney(review.targetBalance), mode: review.mode, description: review.description };
}
const pendingError = () => new AppError("CONFLICT", "نتیجهٔ اصلاح قبلی هنوز مشخص نیست؛ ابتدا نتیجهٔ همان درخواست را بررسی کنید.");
const storageError = () => new AppError("SERVER", "ذخیرهٔ امن درخواست ممکن نیست؛ برای جلوگیری از ثبت تکراری، اصلاح موجودی ارسال نشد.");

export type WalletCorrectionOutcome = { receipt: WalletCorrectionReceipt; replayed: boolean };
export type WalletCorrectionResolution = { kind: "none" | "unknown" } | ({ kind: "saved" } & WalletCorrectionOutcome);

/** No automatic retry and no background outbox. Only explicitly confirmed requests are sent. */
export class WalletCorrectionUseCase {
  constructor(private readonly repo: WalletRepository, private readonly storage: SecureStorage) {}
  balance(scope: WalletScope) { return this.repo.balance(scope); }
  history(scope: WalletScope) { return this.repo.history(scope); }

  async pending(scope: WalletScope): Promise<PendingWalletCorrection | null> {
    const saved = await this.storage.get<PendingWalletCorrection>(keyFor(scope), { rejectInvalid: true });
    if (!saved) return null;
    // A corrupt or foreign retained request is not permission to invent another ID.
    try {
      if (saved.version !== 1 || !saved.scope || !sameScope(saved.scope, scope)
        || !saved.request || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(saved.request.operationId)) throw pendingError();
      const request = validateReview(saved.request);
      if (!sameRequest(request, saved.request)) throw pendingError();
      return saved;
    } catch { throw pendingError(); }
  }

  submit(scope: WalletScope, review: WalletCorrectionReview): Promise<WalletCorrectionOutcome> {
    return withWalletOperationLock(keyFor(scope), async () => {
      const request = validateReview(review);
      const pending = await this.pending(scope);
      if (pending) {
        if (!sameRequest(pending.request, request)) throw pendingError();
        return this.send(scope, pending.request, true);
      }
      if (this.storage.persistent !== true || !canCoordinateWalletOperations()) throw storageError();
      const saved: PendingWalletCorrection = { version: 1, scope: { ...scope }, request: { ...request, operationId: crypto.randomUUID() } };
      try {
        await this.storage.set(keyFor(scope), saved);
        const staged = await this.pending(scope);
        if (!staged || staged.request.operationId !== saved.request.operationId || !sameRequest(staged.request, request)) throw storageError();
      } catch { throw storageError(); }
      return this.send(scope, saved.request, false);
    });
  }

  retry(scope: WalletScope): Promise<WalletCorrectionOutcome> {
    return withWalletOperationLock(keyFor(scope), async () => {
      const saved = await this.pending(scope);
      if (!saved) throw new AppError("NOT_FOUND", "درخواست بازیابی‌شونده‌ای برای این کیف پول وجود ندارد.");
      return this.send(scope, saved.request, true);
    });
  }

  resolve(scope: WalletScope): Promise<WalletCorrectionResolution> {
    return withWalletOperationLock(keyFor(scope), async () => {
      const saved = await this.pending(scope);
      if (!saved) return { kind: "none" };
      let receipt: WalletCorrectionReceipt;
      try { receipt = await this.repo.receipt(scope, saved.request.operationId); }
      catch (error) {
        // A 404 may race a still-running commit. Keep the request for an identical retry.
        if (isAppError(error) && error.status === 404 && error.serverCode === "NOT_FOUND") return { kind: "unknown" };
        throw error;
      }
      this.checkReceipt(scope, saved.request, receipt);
      await this.clearAfterSuccess(scope);
      return { kind: "saved", receipt, replayed: true };
    });
  }

  private async send(scope: WalletScope, request: WalletCorrectionRequest, replayed: boolean): Promise<WalletCorrectionOutcome> {
    let receipt: WalletCorrectionReceipt;
    try { receipt = await this.repo.correct(scope, request); }
    catch (error) {
      // Only an explicit command rejection permits a fresh, manually reviewed request.
      // Network errors, malformed success responses and 5xx outcomes remain unresolved.
      if (isAppError(error) && error.status !== undefined && error.status >= 400 && error.status < 500
        && ![401, 403, 404, 408, 429].includes(error.status)) await this.storage.remove(keyFor(scope));
      throw error;
    }
    this.checkReceipt(scope, request, receipt);
    await this.clearAfterSuccess(scope);
    return { receipt, replayed };
  }
  private checkReceipt(scope: WalletScope, request: WalletCorrectionRequest, receipt: WalletCorrectionReceipt) {
    if (!sameScope({ ...scope, familyId: receipt.familyId, memberId: receipt.createdBy, accountId: receipt.accountId }, scope)
      || receipt.operationId !== request.operationId || receipt.targetBalance !== request.targetBalance
      || receipt.mode !== request.mode || receipt.description !== request.description) throw pendingError();
  }
  private async clearAfterSuccess(scope: WalletScope) {
    // Cleanup failure must not turn a confirmed commit into a reported financial failure.
    // The retained identical request can only replay its durable receipt.
    try { await this.storage.remove(keyFor(scope)); } catch { /* Keep recoverable identity. */ }
  }
}
