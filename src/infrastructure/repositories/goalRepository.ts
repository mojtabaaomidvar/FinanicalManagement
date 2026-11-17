import type { GoalRepository } from "@/domain/goal/goal.repository";
import type { Goal, GoalInput, GoalList } from "@/domain/goal/goal.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface GoalRow {
  id: string; owner_id: string; kind: Goal["kind"]; title: string; note: string | null;
  target_date: string | null; status: Goal["status"]; reminder_enabled: boolean;
  revision: number; created_at: string; updated_at: string;
}

const mapGoal = (row: GoalRow): Goal => ({
  id: row.id, ownerId: row.owner_id, kind: row.kind, title: row.title,
  note: row.note ?? null, targetDate: row.target_date ?? null, status: row.status,
  reminderEnabled: row.reminder_enabled === true, revision: row.revision,
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const goalBody = (input: GoalInput) => ({
  kind: input.kind, title: input.title.trim().replace(/\s+/g, " "), note: input.note?.trim() || null,
  target_date: input.targetDate || null, status: input.status, reminder_enabled: input.reminderEnabled,
});
const path = (id: string) => `/goals/${encodeURIComponent(id)}`;

export class RestGoalRepository implements GoalRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError("NETWORK", "اهداف و آرزوهای شخصی به اتصال اینترنت نیاز دارند.");
    }
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError("NETWORK", "اهداف و آرزوهای شخصی به اتصال اینترنت نیاز دارند.");
    }
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<GoalList> {
    const result = await this.client.get<{ goals: GoalRow[]; can_create: boolean }>("/goals", await this.options());
    return { goals: result.goals.map(mapGoal), canCreate: result.can_create === true };
  }
  async get(id: string): Promise<Goal> {
    return mapGoal(await this.client.get<GoalRow>(path(id), await this.options()));
  }
  async add(input: GoalInput): Promise<Goal> {
    return mapGoal(await this.client.post<GoalRow>("/goals", goalBody(input), await this.options()));
  }
  async update(id: string, input: GoalInput, baseRevision: number): Promise<Goal> {
    return mapGoal(await this.client.patch<GoalRow>(path(id), { ...goalBody(input), base_revision: baseRevision }, await this.options()));
  }
  async remove(id: string, baseRevision: number): Promise<void> {
    await this.client.del<void>(`${path(id)}?base_revision=${encodeURIComponent(baseRevision)}`, await this.options());
  }
}
