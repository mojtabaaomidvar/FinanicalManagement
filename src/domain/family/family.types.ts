/* انتیتی خانواده و اعضا */

export type MemberRole = "owner" | "member";
export type MemberStatus = "pending" | "active";
export type ThemeMode = "light" | "dark" | "auto";

export interface Family {
  id: string;
  name: string;
  code: string;
  budget: number;
  currency: string;
  dark: boolean;
}

export interface Member {
  id: string;
  familyId: string;
  name: string;
  role: MemberRole;
  phone: string | null;
  createdAt: string;
  /* پروفایل (v5.1) */
  gender: "male" | "female" | null;
  /** "YYYY-MM-DD" میلادی */
  birthDate: string | null;
  nationalId: string | null;
  avatarUrl: string | null;
  /** pending = معرفی‌شده توسط مدیر، منتظر ثبت‌نام خودش */
  status: MemberStatus;
  /** تنظیم شخصی تم — auto = بر اساس ساعت */
  theme: ThemeMode;
}

export interface ProfileInput {
  name: string;
  gender: "male" | "female" | null;
  /** "YYYY-MM-DD" میلادی */
  birthDate: string | null;
  nationalId: string | null;
  avatarUrl: string | null;
  /** تغییر اختیاری — null = بدون تغییر */
  theme?: ThemeMode | null;
}

export interface FamilySettings {
  budget: number;
  currency: string;
  dark: boolean;
}
