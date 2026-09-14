/* اینترفیس مخزن تنظیمات تشخیص پیامک — پیاده‌سازی در infrastructure/repositories */

import type { Account } from "@/domain/account/account.types";
import type {
  SmsNumber,
  SmsNumberInput,
  SmsSender,
} from "./sms-settings.types";

export interface SmsSettingsRepository {
  /** فعال/غیرفعال‌کردن تشخیص برای «یک» حساب موجود.

      بولین صریح می‌گیرد نه toggle: اگر درخواست به‌خاطر شبکه دوبار برود،
      toggle وضعیت را برمی‌گرداند و کاربر بی‌آنکه بداند دوباره خاموش می‌شود.
      حساب تازه ساخته نمی‌شود؛ نبودنش خطای NOT_FOUND است. */
  setEnabled(accountId: string, enabled: boolean): Promise<Account>;

  /** بازنشانی کامل تنظیمات تشخیص یک حساب (خاموش + پاک‌کردن فرستنده‌ها).
      خود حساب و تراکنش‌هایش دست‌نخورده می‌مانند. */
  resetAccount(accountId: string): Promise<void>;

  /** همه فرستنده‌های مجاز خانواده (هر کدام به یک حساب بسته است) */
  listSenders(): Promise<SmsSender[]>;
  addSender(accountId: string, sender: string): Promise<SmsSender>;
  removeSender(senderId: string): Promise<void>;

  /** شماره‌های «اضافه» عضو جاری. شماره ثبت‌نام اینجا نیست — روی پروفایل است */
  listNumbers(): Promise<SmsNumber[]>;
  addNumber(input: SmsNumberInput): Promise<SmsNumber>;
  setNumberActive(numberId: string, active: boolean): Promise<SmsNumber>;
  removeNumber(numberId: string): Promise<void>;
}
