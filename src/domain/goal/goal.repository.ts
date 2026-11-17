import type { Goal, GoalInput, GoalList } from "./goal.types";

export interface GoalRepository {
  list(): Promise<GoalList>;
  get(id: string): Promise<Goal>;
  add(input: GoalInput): Promise<Goal>;
  update(id: string, input: GoalInput, baseRevision: number): Promise<Goal>;
  remove(id: string, baseRevision: number): Promise<void>;
}
