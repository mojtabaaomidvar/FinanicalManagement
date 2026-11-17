import type { Task, TaskInput } from "./task.types";

export interface TaskRepository {
  list(): Promise<Task[]>;
  add(input: TaskInput): Promise<Task>;
  update(id: string, input: TaskInput, expectedRevision?: number): Promise<Task>;
  setCompleted(id: string, completed: boolean, expectedRevision?: number,
    completionPhoto?: string | null): Promise<Task>;
  remove(id: string, expectedRevision?: number): Promise<void>;
}
