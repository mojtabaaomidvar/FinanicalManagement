/* اینترفیس مخزن تراکنش‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Transaction, TransactionInput, TransactionPhoto, RecurringUpdate, OccurrenceSettle, TransferFeeMethod } from "./transaction.types";
import type { Money } from "@/shared/lib/money";

export interface TransactionRepository {
  quoteTransferFee?(method: TransferFeeMethod, amountRial: Money): Promise<Money>;
  list(): Promise<Transaction[]>;
  add(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<void>;
  remove(id: string): Promise<void>;
  /** ثبت رسیدگی به یک سررسید تراکنش تکرارشونده (ثبت‌شده یا رد‌شده) —
      تاریخ سررسید میلادی ISO به فهرست handled_occurrences افزوده می‌شود */
  markOccurrence(id: string, dueDate: string): Promise<void>;
  updateRecurring?(id: string, input: RecurringUpdate): Promise<Transaction>;
  settleOccurrence?(id: string, input: OccurrenceSettle): Promise<Transaction>;
  /** آپلود تصویر پیوست به Storage — URL عمومی برمی‌گرداند */
  uploadPhoto(dataUrl: string): Promise<string>;
  addPhoto(txId: string, url: string, caption: string | null): Promise<TransactionPhoto>;
  updatePhotoCaption(photoId: string, caption: string | null): Promise<void>;
  removePhoto(photoId: string): Promise<void>;
}
