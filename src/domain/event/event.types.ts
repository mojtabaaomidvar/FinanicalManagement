/* انتیتی و اینترفیس رویدادهای مهم خانواده */

export interface FamilyEvent {
  id: string;
  familyId: string;
  memberId: string | null;
  /** رویدادِ متعلق به کدام عضو (اختیاری — مثلاً تولدِ چه کسی) */
  forMemberId: string | null;
  title: string;
  /** "YYYY-MM-DD" میلادی */
  date: string;
  note: string | null;
  createdAt: string;
}

export interface EventInput {
  title: string;
  /** "YYYY-MM-DD" میلادی */
  date: string;
  note?: string | null;
  /** سازنده رویداد (اختیاری — مدیر می‌تواند برای دیگری بسازد) */
  memberId?: string | null;
  /** عضوِ مربوط به رویداد (اختیاری — مثلاً تولدِ کدام عضو) */
  forMemberId?: string | null;
}

export interface EventRepository {
  list(): Promise<FamilyEvent[]>;
  add(input: EventInput): Promise<FamilyEvent>;
  remove(id: string): Promise<void>;
  /** همگام‌سازی رویدادهای تولد از تاریخ تولد اعضا */
  syncBirthdays(): Promise<number>;
}
