import type { EquipmentRepository } from "@/domain/equipment/equipment.repository";
import type { EquipmentInput, MaintenanceInput } from "@/domain/equipment/equipment.types";

export class ListEquipmentUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute() { return this.repo.list(); }
}
export class AddEquipmentUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute(input: EquipmentInput) { return this.repo.add(input); }
}
export class UpdateEquipmentUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute(id: string, input: EquipmentInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); }
}
export class DeleteEquipmentUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute(id: string, baseRevision: number) { return this.repo.remove(id, baseRevision); }
}
export class ListMaintenanceUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute(id: string) { return this.repo.listMaintenance(id); }
}
export class AddMaintenanceUseCase {
  constructor(private readonly repo: EquipmentRepository) {}
  execute(id: string, input: MaintenanceInput, baseRevision: number, operationId: string) {
    return this.repo.addMaintenance(id, input, baseRevision, operationId);
  }
}
