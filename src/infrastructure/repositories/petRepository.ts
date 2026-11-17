import type { PetRepository } from "@/domain/pet/pet.repository";
import type { Pet, PetCareInput, PetCareTask, PetDetail, PetInput, PetList } from "@/domain/pet/pet.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface PetRow {
  id: string; name: string; species: string; breed: string | null; birth_date: string | null;
  revision: number; created_at: string; updated_at: string; can_edit: boolean; can_delete: boolean;
}
interface CareRow {
  id: string; title: string; assignee_id: string | null; due_date: string | null;
  completed: boolean; revision: number; can_complete: boolean;
}
const mapPet = (row: PetRow): Pet => ({
  id: row.id, name: row.name, species: row.species, breed: row.breed ?? null, birthDate: row.birth_date ?? null,
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, canEdit: row.can_edit === true, canDelete: row.can_delete === true,
});
const mapCare = (row: CareRow): PetCareTask => ({
  id: row.id, title: row.title, assigneeId: row.assignee_id ?? null, dueDate: row.due_date ?? null,
  completed: row.completed === true, revision: row.revision, canComplete: row.can_complete === true,
});
const petBody = (input: PetInput) => ({ name: input.name.trim(), species: input.species.trim(), breed: input.breed?.trim() || null, birth_date: input.birthDate });
const path = (id: string) => `/pets/${encodeURIComponent(id)}`;

export class RestPetRepository implements PetRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;
    if (offline()) throw new AppError("NETWORK", "بخش حیوانات خانگی به اتصال اینترنت نیاز دارد.");
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    if (offline()) throw new AppError("NETWORK", "بخش حیوانات خانگی به اتصال اینترنت نیاز دارد.");
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<PetList> {
    const result = await this.client.get<{ pets: PetRow[]; can_create: boolean }>("/pets", await this.options());
    return { pets: result.pets.map(mapPet), canCreate: result.can_create === true };
  }
  async get(id: string): Promise<PetDetail> {
    const result = await this.client.get<{ pet: PetRow; care_tasks: CareRow[]; can_create_care: boolean }>(path(id), await this.options());
    return { pet: mapPet(result.pet), careTasks: result.care_tasks.map(mapCare), canCreateCare: result.can_create_care === true };
  }
  async add(input: PetInput): Promise<Pet> { return mapPet(await this.client.post<PetRow>("/pets", petBody(input), await this.options())); }
  async update(id: string, input: PetInput, baseRevision: number): Promise<Pet> {
    return mapPet(await this.client.patch<PetRow>(path(id), { ...petBody(input), base_revision: baseRevision }, await this.options()));
  }
  async remove(id: string, baseRevision: number): Promise<void> {
    await this.client.del<void>(`${path(id)}?base_revision=${encodeURIComponent(baseRevision)}`, await this.options());
  }
  async addCare(id: string, input: PetCareInput, baseRevision: number, operationId: string): Promise<PetCareTask> {
    return mapCare(await this.client.post<CareRow>(`${path(id)}/care-tasks`, {
      title: input.title.trim(), assignee_id: input.assigneeId, due_date: input.dueDate,
      base_revision: baseRevision, operation_id: operationId,
    }, await this.options()));
  }
}
