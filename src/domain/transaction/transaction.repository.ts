/* اینترفیس مخزن تراکنش‌ها — پیاده‌سازی در infrastructure/repositories */

import type { Transaction, TransactionInput } from "./transaction.types";

export interface TransactionRepository {
  list(): Promise<Transaction[]>;
  add(input: TransactionInput): Promise<Transaction>;
  update(id: string, input: TransactionInput): Promise<void>;
  remove(id: string): Promise<void>;
  /** آپلود تصویر پیوست به Storage — URL عمومی برمی‌گرداند */
  uploadPhoto(dataUrl: string): Promise<string>;
  addPhoto(txId: string, url: string, caption: string | null): Promise<void>;
  updatePhotoCaption(photoId: string, caption: string | null): Promise<void>;
  removePhoto(photoId: string): Promise<void>;
}
