/* اینترفیس مخزن خانواده — پیاده‌سازی در infrastructure/repositories */

import type {
  Family,
  FamilySettings,
  Member,
  ProfileInput,
} from "./family.types";

export interface FamilyRepository {
  getFamily(): Promise<Family>;
  getMembers(): Promise<Member[]>;
  updateSettings(settings: FamilySettings): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  /** ویرایش پروفایل خود کاربر */
  updateOwnProfile(input: ProfileInput): Promise<Member>;
  /** افزودن عضو توسط مدیر (اسم، شماره و نسبت — عضو pending) */
  addMemberByManager(name: string, phone: string, relation: string): Promise<Member>;
  /** تغییر سریع تم شخصی */
  setTheme(theme: "light" | "dark" | "auto"): Promise<void>;
}
