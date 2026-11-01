/* انتیتی خانواده و اعضا */

export type MemberRole = "owner" | "member";
export type MemberStatus = "pending" | "active";

/** وضعیتِ *عضویت* — محورِ دومی که ورود به آن گره خورده است (§۲.۵/§۲.۶).
 *
 *  با `MemberStatus` اشتباه نشود؛ این دو چیزِ متفاوت‌اند:
 *  - `status`        → «مدیر او را معرفی کرده ولی خودش ثبت‌نام نکرده»
 *  - `membershipState` → «عضویتش زنده است یا نه» ← گیتِ ورود
 *
 *  عضوی می‌تواند `status='active'` باشد (خودش کامل ثبت‌نام کرده) و همچنان
 *  `membershipState='pending'` داشته باشد، یعنی نتواند وارد شود. پیش از این،
 *  فرانت فقط محورِ اول را می‌شناخت و چنین عضوی «سالم» دیده می‌شد.
 *
 *  هر شش مقدار از CHECKِ پایگاه داده آمده‌اند، نه از آنچه امروز نوشته می‌شود:
 *  فعلاً فقط سه تای اول تولید می‌شوند و سه تای آخر برای چرخهٔ کاملِ §۲.۵
 *  رزرو شده‌اند. عمداً باریک‌تر گرفته نشده‌اند تا وقتی سرور شروع به نوشتنشان
 *  کرد، `switch`های اینجا کامپایل‌نشدن بدهند به‌جای اینکه بی‌صدا رد شوند.
 *  **تنها `active` یعنی «می‌تواند وارد شود»** — بقیه همه مسدودند. */
export type MembershipState =
  | "pending"
  | "active"
  | "rejected"
  | "expired"
  | "suspended"
  | "removed";

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
  /* nationalId حذف شد (۲۰۲۶-۰۹-۰۸): کدملی از کل برنامه حذف شد */
  avatarUrl: string | null;
  /** pending = معرفی‌شده توسط مدیر، منتظر ثبت‌نام خودش */
  status: MemberStatus;
  /** وضعیتِ تأییدِ عضویت — `null` یعنی «سرور نگفته»، نه «تأیید شده».
      عمداً به «active» پیش‌فرض نمی‌شود: سرورِ قدیمی که این ستون را
      نمی‌فرستد نباید باعث شود عضوِ در‌انتظار، تأییدشده نشان داده شود. */
  membershipState: MembershipState | null;
  /** تنظیم شخصی تم — auto = بر اساس ساعت */
  theme: ThemeMode;
  /** نسبت با مدیر خانواده */
  relation: string;
  /** واحد پول نمایشی شخصی (v5.8) — تومان | ریال.
      مبالغ همیشه به تومان ذخیره می‌شوند؛ این فقط نمایش را عوض می‌کند
      و برخلاف گذشته روی سایر اعضای خانواده اثر ندارد. */
  currency: string;
}

/** یک درخواستِ پیوستن که منتظرِ تصمیمِ مدیر است (§۲.۶).
 *
 *  سرور فقط درخواست‌های `state='pending'` همان خانواده را می‌دهد، ولی `state`
 *  عمداً در نوع باقی مانده تا اگر روزی تاریخچه هم برگردد، UI مجبور نشود
 *  حدس بزند. فیلدهای متقاضی nullable‌اند چون ردیفِ عضو می‌تواند حذف شده باشد
 *  و JOIN خالی برگردد — UI باید این حالت را جدی بگیرد، نه با `!` ردش کند. */
export interface JoinRequest {
  id: string;
  memberId: string | null;
  memberName: string | null;
  phone: string | null;
  relation: string | null;
  /** از کدام راه آمده: «link» = لینکِ دعوت، «code» = کدِ خانواده */
  via: JoinRequestVia;
  state: string;
  /** ISO میلادی با T — برای نمایش باید به جلالی برگردد */
  requestedAt: string;
}

export type JoinRequestVia = "link" | "code";

export interface ProfileInput {
  name: string;
  gender: "male" | "female" | null;
  /** "YYYY-MM-DD" میلادی */
  birthDate: string | null;
  /* nationalId حذف شد (۲۰۲۶-۰۹-۰۸) */
  avatarUrl: string | null;
  /** تغییر اختیاری — null = بدون تغییر */
  theme?: ThemeMode | null;
}

/* FamilySettings بازنشسته شد (v5.8): واحد پول و تم شخصی شدند
   (Member.currency و Member.theme) و تنها تنظیم خانوادگی باقی‌مانده
   سقف بودجه ماهانه است — FamilyRepository.setMonthlyBudget. */
