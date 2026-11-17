export interface Task {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  /** A calendar day stored as Gregorian YYYY-MM-DD and displayed in Jalali. */
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
  /** Missing on tasks saved before completion photos were added. */
  completionPhotoUrl?: string | null;
  /** The creator reference is cleared if that member account is deleted. */
  createdBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
}
