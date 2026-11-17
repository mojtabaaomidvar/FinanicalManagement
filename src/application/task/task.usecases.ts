import type { TaskRepository } from "@/domain/task/task.repository";
import type { Task, TaskInput } from "@/domain/task/task.types";

export class ListTasksUseCase {
  constructor(private readonly repo: TaskRepository) {}
  execute(): Promise<Task[]> { return this.repo.list(); }
}

export class AddTaskUseCase {
  constructor(private readonly repo: TaskRepository) {}
  execute(input: TaskInput): Promise<Task> { return this.repo.add(input); }
}

export class UpdateTaskUseCase {
  constructor(private readonly repo: TaskRepository) {}
  execute(id: string, input: TaskInput, expectedRevision?: number): Promise<Task> {
    return this.repo.update(id, input, expectedRevision);
  }
}

export class SetTaskCompletedUseCase {
  constructor(private readonly repo: TaskRepository) {}
  execute(id: string, completed: boolean, expectedRevision?: number,
    completionPhoto?: string | null): Promise<Task> {
    return this.repo.setCompleted(id, completed, expectedRevision, completionPhoto);
  }
}

export class DeleteTaskUseCase {
  constructor(private readonly repo: TaskRepository) {}
  execute(id: string, expectedRevision?: number): Promise<void> {
    return this.repo.remove(id, expectedRevision);
  }
}
