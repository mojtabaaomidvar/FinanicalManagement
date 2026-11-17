import type { PetRepository } from "@/domain/pet/pet.repository";
import type { PetCareInput, PetInput } from "@/domain/pet/pet.types";

export class ListPetsUseCase { constructor(private readonly repo: PetRepository) {} execute() { return this.repo.list(); } }
export class GetPetUseCase { constructor(private readonly repo: PetRepository) {} execute(id: string) { return this.repo.get(id); } }
export class AddPetUseCase { constructor(private readonly repo: PetRepository) {} execute(input: PetInput) { return this.repo.add(input); } }
export class UpdatePetUseCase {
  constructor(private readonly repo: PetRepository) {}
  execute(id: string, input: PetInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); }
}
export class DeletePetUseCase { constructor(private readonly repo: PetRepository) {} execute(id: string, baseRevision: number) { return this.repo.remove(id, baseRevision); } }
export class AddPetCareUseCase {
  constructor(private readonly repo: PetRepository) {}
  execute(id: string, input: PetCareInput, baseRevision: number, operationId: string) { return this.repo.addCare(id, input, baseRevision, operationId); }
}
