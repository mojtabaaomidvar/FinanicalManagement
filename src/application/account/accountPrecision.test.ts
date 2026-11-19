import { expect, it, vi } from "vitest";
import type { AccountRepository } from "@/domain/account/account.repository";
import { AddAccountUseCase, UpdateAccountUseCase } from "./account.usecases";
it("passes every rial through creation and update without rounding base toman", async () => {
  const add = vi.fn().mockResolvedValue({}), update = vi.fn().mockResolvedValue({});
  const repo = { add, update } as unknown as AccountRepository;
  await new AddAccountUseCase(repo).execute({ memberId: "self", title: "Wallet", kind: "wallet", initialBalance: 1499.9 });
  expect(add.mock.calls[0][0].initialBalance).toBe(1499.9);
  await new UpdateAccountUseCase(repo).execute({ id: "wallet", title: "Wallet", kind: "wallet", initialBalance: -0.1 });
  expect(update.mock.calls[0][0].initialBalance).toBe(-0.1);
});
