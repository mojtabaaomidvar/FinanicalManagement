/* Use-caseهای کارت/حساب — اعتبارسنجی دامنه + مخزن */

import type { AccountRepository } from "@/domain/account/account.repository";
import {
  validateAccountInput,
  validateAccountPatch,
  digitsOf,
} from "@/domain/account/account.rules";
import type {
  Account,
  AccountInput,
  AccountPatch,
} from "@/domain/account/account.types";
import { AppError } from "@/shared/lib/appError";

/* پیام‌های خطای مشترک افزودن و ویرایش */
const ACCOUNT_ERRORS: Record<string, string> = {
  EMPTY_ACCOUNT: "برای حساب بانکی، شماره کارت ۱۶ رقمی الزامی است",
  INVALID_CARD: "شماره کارت باید ۱۶ رقم باشد",
  INVALID_INITIAL_BALANCE: "موجودی معتبر نیست",
  INVALID_TITLE: "نام کارت/حساب معتبر نیست (حداکثر ۴۰ کاراکتر)",
};

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
      throw new AppError(
        "INVALID_ACCOUNT",
        ACCOUNT_ERRORS[v.error ?? ""] ?? "اطلاعات کارت/حساب معتبر نیست",
      );
    }
    return this.repo.add({
      ...input,
      cardNumber: input.cardNumber ? digitsOf(input.cardNumber) : null,
      initialBalance: input.initialBalance ?? 0,
    });
  }
}

export class UpdateAccountUseCase {
  constructor(private readonly repo: AccountRepository) {}
  async execute(patch: AccountPatch): Promise<Account> {
    const v = validateAccountPatch(patch);
    if (!v.ok) {
      throw new AppError(
        "INVALID_ACCOUNT",
        ACCOUNT_ERRORS[v.error ?? ""] ?? "اطلاعات کارت/حساب معتبر نیست",
      );
    }
    return this.repo.update({
      ...patch,
      cardNumber: patch.cardNumber ? digitsOf(patch.cardNumber) : null,
      initialBalance: patch.initialBalance ?? undefined,
    });
  }
}

export class DeleteAccountUseCase {
  constructor(private readonly repo: AccountRepository) {}
  execute(id: string, confirmation?: string): Promise<void> {
    return this.repo.remove(id, confirmation);
  }
}
