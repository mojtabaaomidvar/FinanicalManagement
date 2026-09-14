/* Use-caseهای تنظیمات تشخیص پیامک — رضایت به‌ازای هر حساب.

   اصل حاکم بر این فایل: «خانه‌یار پیشنهاد می‌دهد؛ کاربر تصمیم می‌گیرد.»
   هیچ‌کدام از این یوزکیس‌ها حساب یا کارت نمی‌سازند؛ همه روی حساب‌هایی کار
   می‌کنند که کاربر از قبل ثبت کرده است. */

import type { Account } from "@/domain/account/account.types";
import { normalizePhone } from "@/domain/auth/auth.rules";
import type { SmsSettingsRepository } from "@/domain/sms/sms-settings.repository";
import type {
  SmsNumber,
  SmsNumberInput,
  SmsSender,
} from "@/domain/sms/sms-settings.types";
import { AppError } from "@/shared/lib/appError";

/** فعال/غیرفعال‌کردن تشخیص برای یک حساب موجود.

    کیف‌پول عمدا اینجا هم رد می‌شود، نه فقط در سرور: پیام خطای فوری بهتر از
    رفت‌وبرگشت شبکه است و اگر روزی UI اشتباهی کلید را برای کیف‌پول نشان داد،
    این لایه جلویش را می‌گیرد. */
export class SetAccountSmsEnabledUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(account: Account, enabled: boolean): Promise<Account> {
    if (enabled && account.kind !== "bank") {
      throw new AppError(
        "INVALID_SMS",
        "تشخیص از پیامک فقط برای حساب بانکی یا کارت معنا دارد",
      );
    }
    return this.repo.setEnabled(account.id, enabled);
  }
}

/** بازنشانی تنظیمات تشخیص یک حساب — خود حساب و تراکنش‌ها دست‌نخورده می‌مانند */
export class ResetAccountSmsUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(accountId: string): Promise<void> {
    return this.repo.resetAccount(accountId);
  }
}

export class ListSmsSendersUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(): Promise<SmsSender[]> {
    return this.repo.listSenders();
  }
}

export class AddSmsSenderUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(accountId: string, sender: string): Promise<SmsSender> {
    const value = (sender || "").trim();
    if (!value) {
      throw new AppError("INVALID_SMS", "شماره فرستنده را وارد کنید");
    }
    /* نرمال‌سازی نهایی با سرور است (همان‌جا که مقایسه انجام می‌شود) تا دو
       پیاده‌سازی از هم جدا نیفتند؛ اینجا فقط خالی‌نبودن بررسی می‌شود. */
    return this.repo.addSender(accountId, value);
  }
}

export class RemoveSmsSenderUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(senderId: string): Promise<void> {
    return this.repo.removeSender(senderId);
  }
}

export class ListSmsNumbersUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(): Promise<SmsNumber[]> {
    return this.repo.listNumbers();
  }
}

/** افزودن شماره مجاز — بدون کد تأیید، پس همیشه «تأیید نشده» می‌ماند.

    افزودن شماره به‌تنهایی اجازه خواندن پیامک‌های آن شماره را نمی‌دهد؛ فقط
    آن را به فهرست «منابع مجاز» اضافه می‌کند. */
export class AddSmsNumberUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(input: SmsNumberInput): Promise<SmsNumber> {
    const phone = normalizePhone(input.phone || "");
    if (!phone) {
      throw new AppError("INVALID_SMS", "شماره موبایل معتبر نیست");
    }
    return this.repo.addNumber({
      phone,
      label: (input.label || "").trim() || null,
    });
  }
}

/** خاموش/روشن‌کردن موقت یک شماره بدون حذفش */
export class SetSmsNumberActiveUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(numberId: string, active: boolean): Promise<SmsNumber> {
    return this.repo.setNumberActive(numberId, active);
  }
}

export class RemoveSmsNumberUseCase {
  constructor(private readonly repo: SmsSettingsRepository) {}
  execute(numberId: string): Promise<void> {
    return this.repo.removeNumber(numberId);
  }
}
