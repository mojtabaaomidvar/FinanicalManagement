import type { Activity, ActivityInput, ActivityList } from "./activity.types";

export interface ActivityRepository {
  list(): Promise<ActivityList>;
  get(id: string): Promise<Activity>;
  add(input: ActivityInput): Promise<Activity>;
  update(id: string, input: ActivityInput, baseRevision: number): Promise<Activity>;
  remove(id: string, baseRevision: number): Promise<void>;
}
