import type { ActivityRepository } from "@/domain/activity/activity.repository";
import type { Activity, ActivityInput, ActivityList } from "@/domain/activity/activity.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface ActivityRow {
  id: string; title: string; note: string | null; date: string; location: string | null;
  status: Activity["status"]; participant_ids: string[]; reminder_enabled: boolean; created_by: string | null;
  revision: number; created_at: string; updated_at: string; can_edit: boolean; can_delete: boolean;
}
const mapActivity = (row: ActivityRow): Activity => ({
  id: row.id, title: row.title, note: row.note ?? null, date: row.date, location: row.location ?? null,
  status: row.status, participantIds: [...row.participant_ids], reminderEnabled: row.reminder_enabled === true,
  createdBy: row.created_by ?? null, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  canEdit: row.can_edit === true, canDelete: row.can_delete === true,
});
const activityBody = (input: ActivityInput) => ({
  title: input.title.trim().replace(/\s+/g, " "), note: input.note?.trim() || null, date: input.date,
  location: input.location?.trim().replace(/\s+/g, " ") || null, status: input.status, participant_ids: [...input.participantIds],
  reminder_enabled: input.reminderEnabled,
});
const path = (id: string) => `/activities/${encodeURIComponent(id)}`;

export class RestActivityRepository implements ActivityRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AppError("NETWORK", "برنامه‌های خانوادگی به اتصال اینترنت نیاز دارند.");
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AppError("NETWORK", "برنامه‌های خانوادگی به اتصال اینترنت نیاز دارند.");
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<ActivityList> {
    const result = await this.client.get<{ activities: ActivityRow[]; can_create: boolean }>("/activities", await this.options());
    return { activities: result.activities.map(mapActivity), canCreate: result.can_create === true };
  }
  async get(id: string): Promise<Activity> { return mapActivity(await this.client.get<ActivityRow>(path(id), await this.options())); }
  async add(input: ActivityInput): Promise<Activity> { return mapActivity(await this.client.post<ActivityRow>("/activities", activityBody(input), await this.options())); }
  async update(id: string, input: ActivityInput, baseRevision: number): Promise<Activity> {
    return mapActivity(await this.client.patch<ActivityRow>(path(id), { ...activityBody(input), base_revision: baseRevision }, await this.options()));
  }
  async remove(id: string, baseRevision: number): Promise<void> { await this.client.del<void>(`${path(id)}?base_revision=${encodeURIComponent(baseRevision)}`, await this.options()); }
}
