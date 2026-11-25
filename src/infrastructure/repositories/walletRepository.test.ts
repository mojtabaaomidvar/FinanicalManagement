import { describe, expect, it, vi } from "vitest";
import { RestWalletRepository } from "./walletRepository";
import type { RestClient } from "@/infrastructure/api/restClient";
import type { SessionStore } from "@/domain/auth/auth.repository";
import type { StoredSession } from "@/domain/auth/auth.types";
import type { WalletCorrectionRequest, WalletScope } from "@/domain/account/wallet.types";

const scope: WalletScope = { familyId: "family", memberId: "member", accountId: "account" };
const request: WalletCorrectionRequest = { operationId: "operation", baseRevision: 3, targetBalance: "999999999999999.99", mode: "reconciliation", description: null };
const row = {
  id: "receipt", family_id: "family", account_id: "account", created_by: "member", operation_id: "operation",
  mode: "reconciliation", revision: 4, target_balance: request.targetBalance,
  ledger_before: "999999999999999.9", current_before: "999999999999999.9", ledger_after: "999999999999999.9",
  current_after: request.targetBalance, delta: "0.09", description: null, transaction_id: null, created_at: "2026-11-24T12:00:00Z",
};
const balanceRow = { account_id: "account", revision: 4, ledger_balance: "999999999999999.9", current_balance: request.targetBalance, discrepancy: "0.09", active_reconciliation_id: "receipt" };
function setup() {
  const client = { get: vi.fn(), post: vi.fn() };
  const session = { load: vi.fn().mockResolvedValue({ family: { id: "family" }, member: { id: "member", familyId: "family" }, token: "pinned" } as StoredSession) };
  return { client, session, repo: new RestWalletRepository(client as unknown as RestClient, session as unknown as SessionStore) };
}
describe("wallet REST boundary", () => {
  it("retains exact balances, fractions and reconciliation metadata without numeric coercion", async () => {
    const { client, repo } = setup();
    client.get.mockResolvedValueOnce(balanceRow);
    expect(await repo.balance(scope)).toEqual({ accountId: "account", revision: 4, ledgerBalance: "999999999999999.9", currentBalance: request.targetBalance, discrepancy: "0.09", activeReconciliationId: "receipt" });
    expect(client.get).toHaveBeenCalledWith("/accounts/account/balance", { bearer: "pinned", cache: "no-store" });
  });
  it("uses one exact command with no client delta or opening-balance update", async () => {
    const { client, repo } = setup();
    client.post.mockResolvedValueOnce(row);
    expect((await repo.correct(scope, request)).delta).toBe("0.09");
    expect(client.post).toHaveBeenCalledWith("/accounts/account/corrections", {
      operation_id: "operation", base_revision: 3, target_balance: request.targetBalance, mode: "reconciliation", description: null,
    }, { bearer: "pinned", cache: "no-store" });
    expect(client.post).toHaveBeenCalledTimes(1);
  });
  it("history permits another actor's authorized receipt, but recovery does not", async () => {
    const { client, repo } = setup();
    client.get.mockResolvedValueOnce([{ ...row, created_by: "another" }]);
    expect((await repo.history(scope))[0].createdBy).toBe("another");
    client.get.mockResolvedValueOnce({ ...row, created_by: "another" });
    await expect(repo.receipt(scope, "operation")).rejects.toThrow("پاسخ موجودی معتبر نیست");
  });
  it.each([{ familyId: "other" }, { memberId: "other" }])("rejects stale session scope %j before making an HTTP request", async change => {
    const { client, repo } = setup();
    await expect(repo.correct({ ...scope, ...change }, request)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(client.post).not.toHaveBeenCalled();
  });
  it.each([null, { ...balanceRow, account_id: "foreign" }, { ...balanceRow, ledger_balance: 100 },
    { ...balanceRow, ledger_balance: "1e8" }, { ...balanceRow, discrepancy: "0.1" },
    { ...balanceRow, revision: 0.1 }, { ...balanceRow, active_reconciliation_id: null }])(
    "a missing or invalid balance %j is never displayed as zero", async data => {
      const { client, repo } = setup(); client.get.mockResolvedValueOnce(data);
      await expect(repo.balance(scope)).rejects.toThrow("پاسخ موجودی معتبر نیست");
    },
  );
  it.each([{ ...row, family_id: "foreign" }, { ...row, account_id: "foreign" }, { ...row, operation_id: "foreign" },
    { ...row, target_balance: 1500 }, { ...row, delta: "0.1" }, { ...row, transaction_id: "orphan" },
    { ...row, mode: "unknown" }, { ...row, ledger_after: "0" }])("rejects an invalid receipt %j", async data => {
      const { client, repo } = setup(); client.post.mockResolvedValueOnce(data);
      await expect(repo.correct(scope, request)).rejects.toThrow("پاسخ موجودی معتبر نیست");
    },
  );
  it("an invalid history response is not an empty history", async () => {
    const { client, repo } = setup(); client.get.mockResolvedValueOnce(null);
    await expect(repo.history(scope)).rejects.toThrow("پاسخ موجودی معتبر نیست");
  });
});
