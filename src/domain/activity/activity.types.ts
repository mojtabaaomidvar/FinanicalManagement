export type ActivityStatus = "planned" | "done" | "cancelled";

/** Activities and their calendar entries refer to the same server record. */
export interface Activity {
  id: string;
  title: string;
  note: string | null;
  date: string;
  location: string | null;
  status: ActivityStatus;
  participantIds: string[];
  reminderEnabled: boolean;
  createdBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ActivityInput {
  title: string;
  note?: string | null;
  date: string;
  location?: string | null;
  status: ActivityStatus;
  participantIds: string[];
  reminderEnabled: boolean;
}

export interface ActivityList { activities: Activity[]; canCreate: boolean }
