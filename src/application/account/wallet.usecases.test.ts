import { beforeEach, describe, expect, it, vi } from "vitest";
import { WalletCorrectionUseCase } from "./wallet.usecases";
import type { WalletCorrectionReceipt, WalletCorrectionRequest, WalletCorrectionReview, WalletRepository, WalletScope } from "@/domain/account/wallet.types";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import { AppError } from "@/shared/lib/appError";

const scope: WalletScope = { familyId: "family", memberId: "member", accountId: "account" };
const review: WalletCorrectionReview = { baseRevision: 3, targetBalance: "1499.9", mode: "ledger", description: "شرح کاربر" };
const receipt = (request: WalletCorrectionRequest): WalletCorrectionReceipt => ({
  id: "receipt", ...scope, createdBy: scope.memberId, operationId: request.operationId,
  mode: request.mode, revision: 5, targetBalance: request.targetBalance,
  ledgerBefore: "1500", currentBefore: "1500", ledgerAfter: request.targetBalance,
  currentAfter: request.targetBalance, delta: "-0.1", description: request.description,
  transactionId: "transaction", createdAt: "2026-11-24T12:00:00Z",
});
function failure(status: number, serverCode: string) {
  const error = new AppError("SERVER", "test failure");
  error.status = status; error.serverCode = serverCode;
  return error;
}
function setup(persistent = true) {
  const values = new Map<string, unknown>();
  const storage: SecureStorage = {
    persistent,
    get: vi.fn(async (key: string) => values.get(key) ?? null) as SecureStorage["get"],
    set: vi.fn(async (key, value) => { values.set(key, value); }),
    remove: vi.fn(async key => { values.delete(key); }),
  };
  const repo: WalletRepository = {
    balance: vi.fn(), history: vi.fn(),
    correct: vi.fn(async (_scope, request) => receipt(request)), receipt: vi.fn(),
  };
  return { values, storage, repo, useCase: new WalletCorrectionUseCase(repo, storage) };
}

describe("durable wallet correction identity", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("stages the exact request securely before the only financial write", async () => {
    const { useCase, repo, storage } = setup();
    vi.mocked(repo.correct).mockImplementation(async (actualScope, request) => {
      expect(actualScope).toEqual(scope);
      expect((await useCase.pending(scope))?.request).toEqual(request);
      expect(request.targetBalance).toBe("1499.9");
      expect(request.operationId).toMatch(/^[a-f\d-]{36}$/);
      return receipt(request);
    });
    const outcome = await useCase.submit(scope, { ...review, targetBalance: "001499.9000" });
    expect(outcome.replayed).toBe(false);
    expect(outcome.receipt.targetBalance).toBe("1499.9");
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect(repo.correct).toHaveBeenCalledTimes(1);
    expect(await useCase.pending(scope)).toBeNull();
  });

  it("retains a lost response through reload and resolves the original receipt without writing", async () => {
    const { useCase, repo, storage } = setup();
    let committed: WalletCorrectionReceipt | undefined;
    vi.mocked(repo.correct).mockImplementationOnce(async (_scope, request) => {
      committed = receipt(request);
      throw new AppError("NETWORK", "connection lost");
    });
    await expect(useCase.submit(scope, review)).rejects.toThrow("connection lost");
    const pending = await useCase.pending(scope);
    expect(pending?.request.operationId).toBe(committed?.operationId);
    const reloaded = new WalletCorrectionUseCase(repo, storage);
    vi.mocked(repo.receipt).mockResolvedValueOnce(committed!);
    expect(await reloaded.resolve(scope)).toEqual({ kind: "saved", receipt: committed, replayed: true });
    expect(repo.receipt).toHaveBeenCalledWith(scope, committed?.operationId);
    expect(repo.correct).toHaveBeenCalledTimes(1);
    expect(await reloaded.pending(scope)).toBeNull();
  });

  it("an unknown status is not authorization to replace the target, revision, mode, note or ID", async () => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(new AppError("NETWORK", "lost"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    const pending = await useCase.pending(scope);
    vi.mocked(repo.receipt).mockRejectedValueOnce(failure(404, "NOT_FOUND"));
    expect(await useCase.resolve(scope)).toEqual({ kind: "unknown" });
    for (const change of [{ targetBalance: "1500" }, { baseRevision: 4 }, { mode: "reconciliation" as const }, { description: "new" }]) {
      await expect(useCase.submit(scope, { ...review, ...change })).rejects.toThrow("نتیجهٔ اصلاح قبلی");
    }
    expect(await useCase.pending(scope)).toEqual(pending);
    expect(repo.correct).toHaveBeenCalledTimes(1);
    const outcome = await useCase.retry(scope);
    expect(outcome.replayed).toBe(true);
    expect(vi.mocked(repo.correct).mock.calls[1][1]).toEqual(pending?.request);
  });

  it("an identical double submission shares its original identity after an uncertain first result", async () => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(new AppError("NETWORK", "lost"));
    const results = await Promise.allSettled([useCase.submit(scope, review), useCase.submit(scope, review)]);
    expect(results[0].status).toBe("rejected"); expect(results[1].status).toBe("fulfilled");
    expect(vi.mocked(repo.correct).mock.calls[0][1].operationId).toBe(vi.mocked(repo.correct).mock.calls[1][1].operationId);
  });

  it.each([400, 409, 422])("a definite %s command rejection requires a fresh explicit review", async status => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(failure(status, status === 409 ? "WALLET_CONFLICT" : "INVALID_INPUT"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    const id = vi.mocked(repo.correct).mock.calls[0][1].operationId;
    expect(await useCase.pending(scope)).toBeNull();
    await useCase.submit(scope, { ...review, baseRevision: 4 });
    expect(vi.mocked(repo.correct).mock.calls[1][1].operationId).not.toBe(id);
  });

  it.each([401, 403, 404, 408, 429, 500, 502])("does not discard operation identity for an ambiguous or denied %s outcome", async status => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(failure(status, "TEST"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    expect(await useCase.pending(scope)).not.toBeNull();
  });

  it("failed recovery reads retain the request and never automatically resend it", async () => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(failure(500, "SERVER"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    const pending = await useCase.pending(scope);
    vi.mocked(repo.receipt).mockRejectedValueOnce(failure(403, "FORBIDDEN"));
    await expect(useCase.resolve(scope)).rejects.toThrow();
    expect(await useCase.pending(scope)).toEqual(pending);
    expect(repo.correct).toHaveBeenCalledTimes(1);
  });

  it("pending state is isolated by family, member and account", async () => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(new AppError("NETWORK", "lost"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    for (const change of [{ familyId: "other" }, { memberId: "other" }, { accountId: "other" }]) {
      expect(await useCase.pending({ ...scope, ...change })).toBeNull();
      expect(await useCase.resolve({ ...scope, ...change })).toEqual({ kind: "none" });
      await expect(useCase.retry({ ...scope, ...change })).rejects.toThrow("درخواست بازیابی‌شونده‌ای");
    }
    expect(await useCase.pending(scope)).not.toBeNull();
    expect(repo.correct).toHaveBeenCalledTimes(1);
  });

  it("blocks writes without durable secure storage, including a failed staging verification", async () => {
    const fallback = setup(false);
    await expect(fallback.useCase.submit(scope, review)).rejects.toThrow("ذخیرهٔ امن");
    expect(fallback.repo.correct).not.toHaveBeenCalled();
    const broken = setup();
    vi.mocked(broken.storage.set).mockResolvedValueOnce(undefined);
    await expect(broken.useCase.submit(scope, review)).rejects.toThrow("ذخیرهٔ امن");
    expect(broken.repo.correct).not.toHaveBeenCalled();
  });

  it("requests strict decryption and cannot treat unreadable ciphertext as absence", async () => {
    const { useCase, repo, storage } = setup();
    vi.mocked(storage.get).mockRejectedValue(new Error("corrupt ciphertext"));
    await expect(useCase.pending(scope)).rejects.toThrow("corrupt ciphertext");
    await expect(useCase.submit(scope, review)).rejects.toThrow("corrupt ciphertext");
    expect(storage.get).toHaveBeenCalledWith(expect.any(String), { rejectInvalid: true });
    expect(repo.correct).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("does not report a committed correction as failed when local cleanup fails", async () => {
    const { useCase, repo, storage } = setup();
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error("disk failure"));
    const result = await useCase.submit(scope, review);
    expect((await useCase.pending(scope))?.request.operationId).toBe(result.receipt.operationId);
    vi.mocked(repo.receipt).mockResolvedValueOnce(result.receipt);
    expect(await useCase.resolve(scope)).toEqual({ kind: "saved", receipt: result.receipt, replayed: true });
  });

  it("does not accept a foreign or content-mismatched receipt", async () => {
    const { useCase, repo } = setup();
    vi.mocked(repo.correct).mockImplementationOnce(async (_scope, request) => ({ ...receipt(request), targetBalance: "1500" }));
    await expect(useCase.submit(scope, review)).rejects.toThrow("نتیجهٔ اصلاح قبلی");
    expect(await useCase.pending(scope)).not.toBeNull();
    vi.mocked(repo.receipt).mockImplementationOnce(async (_scope, operationId) => ({ ...receipt({ ...review, operationId }), createdBy: "foreign" }));
    await expect(useCase.resolve(scope)).rejects.toThrow();
    expect(await useCase.pending(scope)).not.toBeNull();
  });

  it("corrupt retained state fails closed instead of generating a replacement ID", async () => {
    const { useCase, repo, values } = setup();
    vi.mocked(repo.correct).mockRejectedValueOnce(new AppError("NETWORK", "lost"));
    await expect(useCase.submit(scope, review)).rejects.toThrow();
    const key = [...values.keys()][0];
    values.set(key, { version: 1, scope: { ...scope, memberId: "foreign" }, request: review });
    await expect(useCase.submit(scope, review)).rejects.toThrow("نتیجهٔ اصلاح قبلی");
    expect(repo.correct).toHaveBeenCalledTimes(1);
  });

  it.each([{ targetBalance: "1.001" }, { targetBalance: "1000000000000000" }, { targetBalance: "NaN" },
    { baseRevision: -1 }, { baseRevision: 0.1 }, { description: "ا".repeat(201) }, { mode: "unknown" }])(
    "rejects invalid review %j without staging or writing", async change => {
      const { useCase, repo, storage } = setup();
      await expect(useCase.submit(scope, { ...review, ...change } as WalletCorrectionReview)).rejects.toThrow();
      expect(storage.set).not.toHaveBeenCalled(); expect(repo.correct).not.toHaveBeenCalled();
    },
  );
});
