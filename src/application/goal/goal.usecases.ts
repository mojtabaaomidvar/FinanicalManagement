import type { GoalRepository } from "@/domain/goal/goal.repository";
import type { GoalInput } from "@/domain/goal/goal.types";

export class ListGoalsUseCase {
  constructor(private readonly repo: GoalRepository) {}
  execute() { return this.repo.list(); }
}
export class GetGoalUseCase {
  constructor(private readonly repo: GoalRepository) {}
  execute(id: string) { return this.repo.get(id); }
}
export class AddGoalUseCase {
  constructor(private readonly repo: GoalRepository) {}
  execute(input: GoalInput) { return this.repo.add(input); }
}
export class UpdateGoalUseCase {
  constructor(private readonly repo: GoalRepository) {}
  execute(id: string, input: GoalInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); }
}
export class DeleteGoalUseCase {
  constructor(private readonly repo: GoalRepository) {}
  execute(id: string, baseRevision: number) { return this.repo.remove(id, baseRevision); }
}
