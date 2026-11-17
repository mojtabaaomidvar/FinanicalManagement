import type { OfflineSnapshot, OfflineTask } from "../shopping/offline.types";
import type { Task } from "./task.types";

export const taskFromOffline = (row: OfflineTask): Task => ({
  id: row.id,
  title: row.title,
  description: row.description,
  assigneeId: row.assignee_id,
  dueDate: row.due_date,
  completed: row.completed,
  completedAt: row.completed_at,
  completedBy: row.completed_by,
  completionPhotoUrl: row.completion_photo_url ?? null,
  createdBy: row.created_by,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const offlineTasks = (snapshot: OfflineSnapshot): Task[] =>
  (snapshot.tasks ?? []).map(taskFromOffline);
