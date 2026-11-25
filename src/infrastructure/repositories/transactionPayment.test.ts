import { describe, expect, it } from "vitest";
import { toTransactionBody } from "./transactionRepository";
import type { TransactionInput } from "@/domain/transaction/transaction.types";

const input: TransactionInput = { memberId: "self", type: "expense", category: "food", amount: "1000", date: "2026-11-24" };
describe("payment wire contract", () => {
  it("sends explicit online choice and fee removal on edit", () => {
    expect(toTransactionBody({ ...input, paymentMethod: "online", transferFeeMethod: null }))
      .toMatchObject({ payment_method: "online", transfer_fee_method: null });
  });
  it("does not turn older-client omission into an explicit reset", () => {
    const body = toTransactionBody(input);
    expect(body).not.toHaveProperty("payment_method");
    expect(body).not.toHaveProperty("transfer_fee_method");
  });
});
