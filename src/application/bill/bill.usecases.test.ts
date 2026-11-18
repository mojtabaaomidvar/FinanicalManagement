import { describe, expect, it, vi } from "vitest";
import { AddBillUseCase, UpdateBillUseCase } from "./bill.usecases";
import type { BillRepository } from "@/domain/bill/bill.repository";
import type { BillInput } from "@/domain/bill/bill.types";

const valid: BillInput = { kind: "charge", title: " Charge ", amount: 1200.25, dueDate: "2026-11-18", billNo: " ۰۰۱ ۲۳ ", paymentNo: "۰۰۴۵۶", note: "  my note  " };
const repository = () => ({ list: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), pay: vi.fn(), unpay: vi.fn(), cancel: vi.fn() }) satisfies BillRepository;

describe("bill writes", () => {
  it.each([{ title: " " }, { title: "x".repeat(121) }, { amount: Infinity }, { amount: -1 }, { dueDate: "2026-02-30" }, { billNo: "012x" }, { paymentNo: "0".repeat(41) }])("rejects invalid writes before contacting the repository: %j", async invalid => {
    const repo = repository();
    await expect(new AddBillUseCase(repo).execute({ ...valid, ...invalid })).rejects.toThrow();
    await expect(new UpdateBillUseCase(repo).execute("bill", { ...valid, ...invalid })).rejects.toThrow();
    expect(repo.add).not.toHaveBeenCalled(); expect(repo.update).not.toHaveBeenCalled();
  });
  it("preserves money and identifiers on create and update while trimming outer prose", async () => {
    const repo = repository();
    await new AddBillUseCase(repo).execute(valid);
    const normalized = { ...valid, title: "Charge", billNo: "00123", paymentNo: "00456", note: "my note" };
    expect(repo.add).toHaveBeenCalledExactlyOnceWith(normalized);
    await new UpdateBillUseCase(repo).execute("existing", valid);
    expect(repo.update).toHaveBeenCalledExactlyOnceWith("existing", normalized);
    expect(valid.title).toBe(" Charge ");
  });
});
