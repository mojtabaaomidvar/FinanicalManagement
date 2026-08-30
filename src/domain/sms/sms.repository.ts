/* اینترفیس مخزن پیامک‌های بانکی — پیاده‌سازی در infrastructure/repositories */

import type { BankSms, NewBankSms, SmsStatus } from "./sms.types";

export interface SmsRepository {
  list(status?: SmsStatus): Promise<BankSms[]>;
  /** افزودن دسته‌ای — تعداد افزوده‌شده را برمی‌گرداند */
  addBatch(items: NewBankSms[]): Promise<number>;
  setStatus(id: string, status: SmsStatus): Promise<void>;
}
