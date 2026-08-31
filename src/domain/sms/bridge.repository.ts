/* اینترفیس مخزن پل پیامک — پیاده‌سازی در infrastructure/repositories */

import type { SmsBridge } from "./sms.types";

export interface BridgeRepository {
  /** پل فعال عضو فعلی — null اگر نساخته باشد */
  get(): Promise<SmsBridge | null>;
  /** ساخت/چرخش کلید برای عضو فعلی (کلید قبلی باطل می‌شود) */
  create(): Promise<string>;
}
