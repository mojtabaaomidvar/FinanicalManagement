/** Personal goals are kept only in the current owner's online session. */
export type GoalKind = "goal" | "wish";
export type GoalStatus = "active" | "done";

export interface Goal {
  id: string;
  ownerId: string;
  kind: GoalKind;
  title: string;
  note: string | null;
  targetDate: string | null;
  status: GoalStatus;
  reminderEnabled: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface GoalInput {
  kind: GoalKind;
  title: string;
  note?: string | null;
  targetDate?: string | null;
  status: GoalStatus;
  reminderEnabled: boolean;
}

export interface GoalList {
  goals: Goal[];
  canCreate: boolean;
}
