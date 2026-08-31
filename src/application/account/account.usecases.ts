/* Use-caseهای کارت/حساب — اعتبارسنجی دامنه + مخزن */

import type { AccountRepository } from "@/domain/account/account.repository";
import {
  validateAccountInput,
  digitsOf,
  normalizeSheba,
} from "@/domain/account/account.rules";
import type { Account, AccountInput } from "@/domain/account/account.types";
import { AppError } from "@/shared/lib/appError";

export class ListAccountsUseCase {
  constructor(private readonly repo: AccountRepository) {}
  execute(): Promise<Account[]> {
    return this.repo.list();
  }
}

export class AddAccountUseCase {
  constructor(private readonly repo: AccountRepository) {}
  async execute(input: AccountInput): Promise<Account> {
    const v = validateAccountInput(input);
    if (!v.ok) throw new AppError("INVALID_ACCOUNT", "اطلاعات کارت/حساب معتبر نیست");
    return this.repo.add({
      ...input,
      cardNumber: input.cardNumber ? digitsOf(input.cardNumber) : null,
      accountNumber: input.accountNumber
        ? digitsOf(input.accountNumber)
        : null,
      sheba: input.sheba ? normalizeSheba(input.sheba) : null,
    });
  }
}

export class DeleteAccountUseCase {
  constructor(private readonly repo: AccountRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
