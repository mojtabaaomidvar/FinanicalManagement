/* اینترفیس مخزن کارت‌ها/حساب‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Account, AccountInput, AccountPatch, AccountTransferTarget } from "./account.types";

export interface AccountRepository {
  list(): Promise<Account[]>;
  listTransferTargets(): Promise<AccountTransferTarget[]>;
  add(input: AccountInput): Promise<Account>;
  update(patch: AccountPatch): Promise<Account>;
  remove(id: string, confirmation?: string): Promise<void>;
}
