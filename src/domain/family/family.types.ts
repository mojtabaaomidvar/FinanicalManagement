/* انتیتی خانواده و اعضا */

export type MemberRole = "owner" | "member";

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
}

export interface FamilySettings {
  budget: number;
  currency: string;
  dark: boolean;
}
