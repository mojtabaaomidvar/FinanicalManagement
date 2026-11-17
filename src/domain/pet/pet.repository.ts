import type { Pet, PetCareInput, PetCareTask, PetDetail, PetInput, PetList } from "./pet.types";

export interface PetRepository {
  list(): Promise<PetList>;
  get(id: string): Promise<PetDetail>;
  add(input: PetInput): Promise<Pet>;
  update(id: string, input: PetInput, baseRevision: number): Promise<Pet>;
  remove(id: string, baseRevision: number): Promise<void>;
  addCare(id: string, input: PetCareInput, baseRevision: number, operationId: string): Promise<PetCareTask>;
}
