/* انتیتی و اینترفیس رویدادهای مهم خانواده */

export interface FamilyEvent {
  id: string;
  familyId: string;
  memberId: string | null;
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
}

export interface EventRepository {
  list(): Promise<FamilyEvent[]>;
  add(input: EventInput): Promise<FamilyEvent>;
  remove(id: string): Promise<void>;
}
