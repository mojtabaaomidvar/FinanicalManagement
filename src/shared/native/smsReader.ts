/* پوششِ TS برای پلاگینِ نیتیوِ SmsReader (اندروید).
   وب/iOS: این پلاگین در دسترس نیست؛ isSmsReaderAvailable() نادرست برمی‌گرداند و
   لایهٔ اپ بی‌صدا از آن رد می‌شود (پلِ فورواردر به‌عنوان فالبک می‌ماند). */

import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PermissionState, PluginListenerHandle } from "@capacitor/core";

/** رویدادِ رسیدنِ یک پیامک — متنِ خام + فرستنده (ممکن است null باشد). */
export interface SmsReceivedEvent {
  rawText: string;
  sender: string | null;
}

/** وضعیتِ مجوزِ خواندن/دریافتِ پیامک. */
export interface SmsPermissionStatus {
  sms: PermissionState;
}

export interface StartWatchingOptions {
  /** فیلترِ اختیاریِ فرستنده (زیررشته). خالی/نامشخص = همهٔ پیامک‌ها به پارسر می‌رسند. */
  senderFilter?: string[];
}

export interface SmsReaderPlugin {
  /** وضعیتِ فعلیِ مجوز (متدِ استانداردِ Capacitor). */
  checkPermissions(): Promise<SmsPermissionStatus>;
  /** درخواستِ مجوزِ پیامک؛ وضعیتِ نهایی را برمی‌گرداند. */
  requestSmsPermission(): Promise<SmsPermissionStatus>;
  /** شروعِ گوش‌دادن به پیامک‌های ورودی. */
  startWatching(options?: StartWatchingOptions): Promise<void>;
  /** توقفِ گوش‌دادن. */
  stopWatching(): Promise<void>;
  addListener(
    eventName: "smsReceived",
    listenerFunc: (event: SmsReceivedEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const SmsReader = registerPlugin<SmsReaderPlugin>("SmsReader");

/** فقط روی اندرویدِ نیتیو و وقتی پلاگین رجیستر شده در دسترس است. */
export function isSmsReaderAvailable(): boolean {
  return (
    Capacitor.getPlatform() === "android" &&
    Capacitor.isPluginAvailable("SmsReader")
  );
}
