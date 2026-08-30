/* اینترفیس مخزن کارت‌ها/حساب‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Account, AccountInput } from "./account.types";

export interface AccountRepository {
  list(): Promise<Account[]>;
  add(input: AccountInput): Promise<Account>;
  remove(id: string): Promise<void>;
}
