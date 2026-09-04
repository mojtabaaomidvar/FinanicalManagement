/* Use-caseهای کارت/حساب — اعتبارسنجی دامنه + مخزن */

import type { AccountRepository } from "@/domain/account/account.repository";
import { validateAccountInput, digitsOf } from "@/domain/account/account.rules";
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
    if (!v.ok) {
      const msgs: Record<string, string> = {
        EMPTY_ACCOUNT: "برای حساب بانکی، شماره کارت ۱۶ رقمی الزامی است",
        INVALID_CARD: "شماره کارت باید ۱۶ رقم باشد",
        INVALID_INITIAL_BALANCE: "موجودی اولیه معتبر نیست",
        INVALID_TITLE: "نام کارت/حساب معتبر نیست (حداکثر ۴۰ کاراکتر)",
      };
      throw new AppError(
        "INVALID_ACCOUNT",
        msgs[v.error ?? ""] ?? "اطلاعات کارت/حساب معتبر نیست",
      );
    }
    return this.repo.add({
      ...input,
      cardNumber: input.cardNumber ? digitsOf(input.cardNumber) : null,
      initialBalance:
        input.initialBalance != null
          ? Math.max(0, Math.round(input.initialBalance))
          : 0,
    });
  }
}

export class DeleteAccountUseCase {
  constructor(private readonly repo: AccountRepository) {}
  execute(id: string): Promise<void> {
    return this.repo.remove(id);
  }
}
