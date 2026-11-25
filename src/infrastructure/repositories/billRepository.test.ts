import { describe, expect, it, vi } from "vitest";
import type { RestClient } from "@/infrastructure/api/restClient";
import { RestBillRepository } from "./billRepository";
import { formatMoney, parseMoneyInput } from "@/shared/lib/money";

const row = { id: "bill", kind: "water", title: "User bill", due_date: "2026-11-24", state: "unpaid", created_at: "2026-11-24T10:00:00Z" };

describe("exact bill boundary", () => {
  it.each(["9999999999999.99", "0.1", "0.01", "1200.25"])("preserves %s through reading, both display units and an unchanged edit", async amount => {
    const get = vi.fn().mockResolvedValue([{ ...row, amount }]);
    const patch = vi.fn().mockResolvedValue({ ...row, amount });
    const repository = new RestBillRepository({ get, patch } as unknown as RestClient);
    const [bill] = await repository.list();
    expect(bill.amount).toBe(amount);
    for (const currency of ["تومان", "ریال"]) {
      const reparsed = parseMoneyInput(formatMoney(bill.amount, currency), currency);
      expect(reparsed).toBe(amount);
      const updated = await repository.update(bill.id, { kind: bill.kind, title: bill.title, amount: reparsed!, dueDate: bill.dueDate });
      expect(updated.amount).toBe(amount);
      expect(patch.mock.calls.at(-1)?.[1].amount).toBe(amount);
    }
  });

  it.each([100.25, 9007199254740992, "1e3", "NaN"])("rejects inexact or malformed wire amounts: %s", async amount => {
    const get = vi.fn().mockResolvedValue([{ ...row, amount }]);
    await expect(new RestBillRepository({ get } as unknown as RestClient).list()).rejects.toThrow("Invalid exact decimal");
  });
});
