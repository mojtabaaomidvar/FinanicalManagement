/* اینترفیس مخزن پیامک‌های بانکی — پیاده‌سازی در infrastructure/repositories */

import type { BankSms, NewBankSms, SmsStatus } from "./sms.types";

export interface SmsRepository {
  list(status?: SmsStatus): Promise<BankSms[]>;
  /** افزودن دسته‌ای — تعداد افزوده‌شده را برمی‌گرداند */
  addBatch(items: NewBankSms[]): Promise<number>;
  setStatus(id: string, status: SmsStatus): Promise<void>;
  /** ثبتِ خامِ سمتِ سرور: یک متنِ پیامک را به /sms/ingest می‌فرستد و سرور خودش
      پارس و تشخیص می‌دهد بانکی هست یا نه. تعدادِ رکوردِ ساخته‌شده را برمی‌گرداند
      (۰ = پیامکِ بانکی نبود). فرستنده اختیاری است و برای تشخیصِ بانک کمک می‌کند. */
  ingestRaw(rawText: string, sender?: string | null): Promise<number>;
}
