/* Use-caseهای §۷ اعلان — orchestration بدون UI و بدون state.

   هیچ use-caseای برای «ساختنِ اعلان» نیست و نباید باشد: ساختِ فهرست یک
   تابعِ خالصِ دامنه است (`deriveNotifications`) که ورودی‌اش را از دادهٔ
   از‌قبل‌بارگذاری‌شده می‌گیرد، پس نه I/O دارد نه orchestration. این‌جا فقط
   کارهایی هستند که به سرور می‌روند. */

import type {
  NotificationPrefsPatch,
  NotificationRepository,
  NotificationState,
} from "@/domain/notification/notification.repository";

/** ترجیحات + نادیده‌گرفته‌ها در یک رفت‌و‌برگشت */
export class GetNotificationStateUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(): Promise<NotificationState> {
    return this.repo.getState();
  }
}

/** به‌روزرسانیِ جزئیِ ترجیحات — پاسخ، حالتِ تازه است تا UI حدس نزند */
export class UpdateNotificationPrefsUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(patch: NotificationPrefsPatch): Promise<NotificationState> {
    return this.repo.updatePrefs(patch);
  }
}

export class DismissNotificationUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(key: string): Promise<void> {
    return this.repo.dismiss(key);
  }
}

export class UndismissNotificationUseCase {
  constructor(private readonly repo: NotificationRepository) {}
  execute(key: string): Promise<void> {
    return this.repo.undismiss(key);
  }
}
