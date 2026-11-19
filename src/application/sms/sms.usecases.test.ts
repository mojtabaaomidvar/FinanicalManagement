import { describe, expect, it, vi } from "vitest";
import { ParseSmsImportUseCase, RecordSmsUseCase } from "./sms.usecases";
import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms } from "@/domain/sms/sms.types";
import type { TransactionInput } from "@/domain/transaction/transaction.types";
import type { AddTransactionUseCase } from "@/application/transaction/transaction.usecases";

describe("SMS import and recording", () => {
  it("excludes unrecognizable messages and preserves original amount units", () => {
    const items = new ParseSmsImportUseCase().execute("سلام\n\nبانک ملی برداشت مبلغ 250000 ریال\n\nموجودی 900000 ریال");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "expense", amount: 250000 });
  });
  it("retains a successful transaction before acknowledging and retries acknowledgement alone", async () => {
    const setStatus = vi.fn().mockRejectedValueOnce(new Error("status failed")).mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue({ id: "saved-transaction" });
    const uc = new RecordSmsUseCase({ setStatus } as unknown as SmsRepository, { execute: add } as unknown as AddTransactionUseCase);
    let transactionId: string | undefined;
    const sms = { id: "sms" } as BankSms;
    await expect(uc.execute(sms, {} as TransactionInput, {
      onCreated: tx => { transactionId = tx.id; },
    })).rejects.toThrow("status failed");
    expect(transactionId).toBe("saved-transaction");
    await uc.execute(sms, {} as TransactionInput, { transactionId });
    expect(add).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledTimes(2);
    expect(setStatus).toHaveBeenLastCalledWith("sms", "recorded");
  });
  it("does not acknowledge when financial creation failed", async () => {
    const setStatus = vi.fn();
    const uc = new RecordSmsUseCase({ setStatus } as unknown as SmsRepository,
      { execute: vi.fn().mockRejectedValue(new Error("write failed")) } as unknown as AddTransactionUseCase);
    await expect(uc.execute({ id: "sms" } as BankSms, {} as TransactionInput)).rejects.toThrow("write failed");
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("retains the write but skips acknowledgement after the session changes", async () => {
    const setStatus = vi.fn(), retain = vi.fn();
    const uc = new RecordSmsUseCase({ setStatus } as unknown as SmsRepository,
      { execute: vi.fn().mockResolvedValue({ id: "saved" }) } as unknown as AddTransactionUseCase);
    await uc.execute({ id: "sms" } as BankSms, {} as TransactionInput, { onCreated: retain, isCurrent: () => false });
    expect(retain).toHaveBeenCalledWith({ id: "saved" });
    expect(setStatus).not.toHaveBeenCalled();
  });
});
