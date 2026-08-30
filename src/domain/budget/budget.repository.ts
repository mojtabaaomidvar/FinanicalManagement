/* انتیتی و اینترفیس بودجه — بودجه جزء تنظیمات خانواده است */

import type { FamilySettings } from "../family/family.types";

export interface BudgetInfo {
  budget: number;
  spent: number;
}

export type BudgetRepository = {
  getSettings(): Promise<FamilySettings>;
  updateSettings(settings: FamilySettings): Promise<void>;
};
