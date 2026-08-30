/* اینترفیس مخزن تراکنش‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Transaction, TransactionInput } from "./transaction.types";

export interface TransactionRepository {
  list(): Promise<Transaction[]>;
  add(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<void>;
  remove(id: string): Promise<void>;
}
