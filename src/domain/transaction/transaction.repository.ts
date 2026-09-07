/* اینترفیس مخزن تراکنش‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Transaction, TransactionInput } from "./transaction.types";

export interface TransactionRepository {
  list(): Promise<Transaction[]>;
  add(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<void>;
  remove(id: string): Promise<void>;
  /** ثبتِ رسیدگی به یک سررسیدِ تراکنش تکرارشونده (ثبت‌شده یا رد‌شده) —
      تاریخ سررسید میلادی ISO به فهرست handled_occurrences افزوده می‌شود */
  markOccurrence(id: string, dueDate: string): Promise<void>;
  /** آپلود تصویر پیوست به Storage — URL عمومی برمی‌گرداند */
  uploadPhoto(dataUrl: string): Promise<string>;
  addPhoto(txId: string, url: string, caption: string | null): Promise<void>;
  updatePhotoCaption(photoId: string, caption: string | null): Promise<void>;
  removePhoto(photoId: string): Promise<void>;
}
