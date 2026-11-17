import type { TaskRepository } from "@/domain/task/task.repository";
import type { Task, TaskInput } from "@/domain/task/task.types";
import type { OfflineTaskFields } from "@/domain/shopping/offline.types";
import { offlineTasks } from "@/domain/task/task.view";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";

const taskPayload = (input: TaskInput): OfflineTaskFields => ({
  title: input.title,
  description: input.description ?? null,
  assignee_id: input.assigneeId ?? null,
  due_date: input.dueDate ?? null,
});

/** Tasks use the existing household outbox in both connected and offline mode. */
export class OfflineTaskRepository implements TaskRepository {
  constructor(private readonly engine: ShoppingOfflineEngine) {}

  async list(): Promise<Task[]> {
    const state = await this.engine.readState();
    return offlineTasks(state.view);
  }

  async add(input: TaskInput): Promise<Task> {
    const id = crypto.randomUUID();
    const state = await this.engine.mutate("task.create", id, taskPayload(input));
    return this.find(offlineTasks(state.view), id);
  }

  async update(id: string, input: TaskInput, expectedRevision?: number): Promise<Task> {
    const state = await this.engine.mutate("task.update", id, taskPayload(input), expectedRevision);
    return this.find(offlineTasks(state.view), id);
  }

  async setCompleted(id: string, completed: boolean, expectedRevision?: number,
    completionPhoto?: string | null): Promise<Task> {
    const state = await this.engine.mutate("task.complete", id,
      { completed, completion_photo: completionPhoto }, expectedRevision);
    return this.find(offlineTasks(state.view), id);
  }

  async remove(id: string, expectedRevision?: number): Promise<void> {
    await this.engine.mutate("task.delete", id, {}, expectedRevision);
  }

  private find(tasks: Task[], id: string): Task {
    const task = tasks.find((row) => row.id === id);
    if (!task) throw new Error("این کار دیگر موجود نیست.");
    return task;
  }
}
