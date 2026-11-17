import type { ChildRepository } from "@/domain/child/child.repository";
import type { Child, ChildDetail, ChildInput, ChildList } from "@/domain/child/child.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface ChildRow {
  id: string; name: string; birth_date: string | null; age_years: number | null;
  status: Child["status"]; revision: number; can_edit: boolean;
}
interface ChildDetailRow {
  child: ChildRow;
  tasks: { id: string; title: string; due_date: string | null; completed: boolean }[];
  activities: { id: string; title: string; date: string; location: string | null; status: "planned" | "done" | "cancelled" }[];
  birthday: { id: string; title: string; date: string } | null;
}
const mapChild = (row: ChildRow): Child => ({
  id: row.id, name: row.name, birthDate: row.birth_date ?? null, ageYears: row.age_years ?? null,
  status: row.status, revision: row.revision, canEdit: row.can_edit === true,
});
const body = (input: ChildInput) => ({ name: input.name.trim(), birth_date: input.birthDate });
const path = (id: string) => `/children/${encodeURIComponent(id)}`;

export class RestChildRepository implements ChildRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline()) throw new AppError("NETWORK", "بخش فرزندان به اتصال اینترنت نیاز دارد.");
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    if (offline()) throw new AppError("NETWORK", "بخش فرزندان به اتصال اینترنت نیاز دارد.");
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<ChildList> {
    const result = await this.client.get<{ children: ChildRow[]; can_create: boolean }>("/children", await this.options());
    return { children: result.children.map(mapChild), canCreate: result.can_create === true };
  }
  async get(id: string): Promise<ChildDetail> {
    const result = await this.client.get<ChildDetailRow>(path(id), await this.options());
    return {
      child: mapChild(result.child),
      tasks: result.tasks.map((row) => ({ id: row.id, title: row.title, dueDate: row.due_date ?? null, completed: row.completed === true })),
      activities: result.activities.map((row) => ({ id: row.id, title: row.title, date: row.date, location: row.location ?? null, status: row.status })),
      birthday: result.birthday ? { id: result.birthday.id, title: result.birthday.title, date: result.birthday.date } : null,
    };
  }
  async add(input: ChildInput): Promise<Child> {
    return mapChild(await this.client.post<ChildRow>("/children", body(input), await this.options()));
  }
  async update(id: string, input: ChildInput, baseRevision: number): Promise<Child> {
    return mapChild(await this.client.patch<ChildRow>(path(id), { ...body(input), base_revision: baseRevision }, await this.options()));
  }
}
