/* اینترفیس مخزن خانواده — پیاده‌سازی در infrastructure/repositories */

import type { Family, FamilySettings, Member } from "./family.types";

export interface FamilyRepository {
  getFamily(): Promise<Family>;
  getMembers(): Promise<Member[]>;
  updateSettings(settings: FamilySettings): Promise<void>;
  removeMember(memberId: string): Promise<void>;
}
