import { describe, expect, it, vi } from "vitest";
import { IngestRawSmsUseCase, ParseSmsImportUseCase, RecordSmsUseCase } from "./sms.usecases";
import type { SmsRepository } from "@/domain/sms/sms.repository";
import type { BankSms } from "@/domain/sms/sms.types";
import type { TransactionInput } from "@/domain/transaction/transaction.types";

describe("SMS import and recording", () => {
  it("excludes unrecognizable messages and preserves original amount units", () => {
    const items = new ParseSmsImportUseCase().execute("سلام\n\nبانک ملی برداشت مبلغ 250000 ریال\n\nموجودی 900000 ریال");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "expense", amount: 250000 });
  });
  it("retries the same atomic operation after losing the initial response", async () => {
    const record = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValue({ id: "saved" });
    const uc = new RecordSmsUseCase({ record } as unknown as SmsRepository);
    const retain = vi.fn(), sms = { id: "sms" } as BankSms, input = {} as TransactionInput;
    await expect(uc.execute(sms, input, { onCreated: retain })).rejects.toThrow("response lost");
    expect(retain).not.toHaveBeenCalled();
    await uc.execute(sms, input, { onCreated: retain });
    expect(record.mock.calls).toEqual([["sms", input, undefined], ["sms", input, undefined]]);
    expect(retain).toHaveBeenCalledWith({ id: "saved" });
  });
  it("passes explicit legacy receipts to the server without another financial write", async () => {
    const record = vi.fn().mockResolvedValue({ id: "legacy" });
    await new RecordSmsUseCase({ record } as unknown as SmsRepository).execute(
      { id: "sms" } as BankSms, {} as TransactionInput, { transactionId: "legacy" });
    expect(record).toHaveBeenCalledWith("sms", {}, "legacy");
  });
  it("does not start a write after the session changes", async () => {
    const record = vi.fn(), retain = vi.fn();
    await new RecordSmsUseCase({ record } as unknown as SmsRepository).execute(
      { id: "sms" } as BankSms, {} as TransactionInput, { onCreated: retain, isCurrent: () => false });
    expect(record).not.toHaveBeenCalled(); expect(retain).not.toHaveBeenCalled();
  });
  it("forwards native transport metadata separately from the unchanged message body", async () => {
    const ingestRaw = vi.fn().mockResolvedValue(1);
    const raw = "برداشت مبلغ 250000 ریال؛ 1405/09/03 14:37:52";
    const uc = new IngestRawSmsUseCase({ ingestRaw } as unknown as SmsRepository);
    expect(await uc.execute(raw, "Bank Melli", "2026-11-25T20:00:00Z", "android-pdu:abc")).toBe(1);
    expect(ingestRaw).toHaveBeenCalledWith(raw, "Bank Melli", "2026-11-25T20:00:00Z", "android-pdu:abc");
  });
});
