/* اینترفیس مخزن کارت‌ها/حساب‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Account, AccountInput, AccountPatch } from "./account.types";

export interface AccountRepository {
  list(): Promise<Account[]>;
  add(input: AccountInput): Promise<Account>;
  update(patch: AccountPatch): Promise<Account>;
  remove(id: string): Promise<void>;
}
