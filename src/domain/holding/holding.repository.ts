/* اینترفیس مخزن دارایی‌های بازاری — پیاده‌سازی در infrastructure/repositories */

import type { Holding, HoldingInput, HoldingList, HoldingPatch } from "./holding.types";

export interface HoldingRepository {
  /** فهرست + قیمت و ارزشِ امروز (ارزش‌گذاری روی سرور انجام می‌شود) */
  list(): Promise<HoldingList>;
  add(input: HoldingInput): Promise<Holding>;
  update(patch: HoldingPatch): Promise<Holding>;
  remove(id: string): Promise<void>;
}
