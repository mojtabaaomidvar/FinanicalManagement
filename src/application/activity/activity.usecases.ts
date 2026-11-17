import type { ActivityRepository } from "@/domain/activity/activity.repository";
import type { ActivityInput } from "@/domain/activity/activity.types";

export class ListActivitiesUseCase {
  constructor(private readonly repo: ActivityRepository) {}
  execute() { return this.repo.list(); }
}
export class GetActivityUseCase {
  constructor(private readonly repo: ActivityRepository) {}
  execute(id: string) { return this.repo.get(id); }
}
export class AddActivityUseCase {
  constructor(private readonly repo: ActivityRepository) {}
  execute(input: ActivityInput) { return this.repo.add(input); }
}
export class UpdateActivityUseCase {
  constructor(private readonly repo: ActivityRepository) {}
  execute(id: string, input: ActivityInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); }
}
export class DeleteActivityUseCase {
  constructor(private readonly repo: ActivityRepository) {}
  execute(id: string, baseRevision: number) { return this.repo.remove(id, baseRevision); }
}
