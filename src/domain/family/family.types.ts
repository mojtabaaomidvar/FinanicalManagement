/* انتیتی خانواده و اعضا */

export type MemberRole = "owner" | "member";
export type MemberStatus = "pending" | "active";
export type ThemeMode = "light" | "dark" | "auto";

/** نسبت عضو با مدیر خانواده */
export const MEMBER_RELATIONS = [
  "خودم",
  "همسر",
  "فرزند",
  "پدر/مادر",
  "خواهر/برادر",
  "سایر",
] as const;
export type MemberRelation = (typeof MEMBER_RELATIONS)[number];

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
  /** نسبت با مدیر خانواده */
  relation: string;
  /** واحد پول نمایشی شخصی (v5.8) — تومان | ریال.
      مبالغ همیشه به تومان ذخیره می‌شوند؛ این فقط نمایش را عوض می‌کند
      و برخلاف گذشته روی سایر اعضای خانواده اثر ندارد. */
  currency: string;
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

/* FamilySettings بازنشسته شد (v5.8): واحد پول و تم شخصی شدند
   (Member.currency و Member.theme) و تنها تنظیم خانوادگی باقی‌مانده
   سقف بودجه ماهانه است — FamilyRepository.setMonthlyBudget. */
