/* §۷ — درزِ ماندگاریِ اعلان (پیاده‌سازی در infrastructure).

   فقط دو چیزِ ماندگار این‌جاست: ترجیحِ کاربر، و اینکه چه چیزی را نادیده
   گرفته. خودِ اعلان‌ها ذخیره نمی‌شوند — مشتق‌شده‌اند
   (`notification.rules.ts` و یادداشتِ §7.1 در docs/master-prompt.md). */

import type { NotificationPrefs } from "./notification.types";

/** بستهٔ کاملی که کلاینت برای مشتق‌سازی لازم دارد — در یک درخواست.
 *  ترجیح و نادیده‌گرفته‌ها عمداً با هم می‌آیند تا مرکزِ اعلان با یک رفت‌و‌برگشت
 *  آمادهٔ محاسبه شود، نه دو تا. */
export interface NotificationState {
  prefs: NotificationPrefs;
  dismissed: string[];
}

/** به‌روزرسانیِ جزئی. فیلدِ غایب یعنی «دست نزن».
 *
 *  تفکیکِ «غایب» از «خالی» لازم است: بی آن، خاموش‌کردنِ کلیدِ کلی نقشهٔ
 *  دامنه‌ها را هم پاک می‌کرد و کاربر با روشن‌کردنِ دوبارهٔ کلید، تنظیماتِ
 *  per-domainش را از دست می‌داد. */
export interface NotificationPrefsPatch {
  enabled?: boolean;
  domains?: Record<string, boolean>;
  leadDays?: Record<string, number>;
}

export interface NotificationRepository {
  getState(): Promise<NotificationState>;
  updatePrefs(patch: NotificationPrefsPatch): Promise<NotificationState>;
  /** بی‌خطر در برابرِ تکرار — دو بار زدن خطا نمی‌دهد. */
  dismiss(key: string): Promise<void>;
  undismiss(key: string): Promise<void>;
}
