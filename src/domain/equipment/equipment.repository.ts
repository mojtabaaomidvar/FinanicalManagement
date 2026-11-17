import type { Equipment, EquipmentInput, MaintenanceInput, MaintenanceRecord, MaintenanceResult } from "./equipment.types";

export interface EquipmentRepository {
  list(): Promise<Equipment[]>;
  add(input: EquipmentInput): Promise<Equipment>;
  update(id: string, input: EquipmentInput, baseRevision: number): Promise<Equipment>;
  remove(id: string, baseRevision: number): Promise<void>;
  listMaintenance(id: string): Promise<MaintenanceRecord[]>;
  addMaintenance(id: string, input: MaintenanceInput, baseRevision: number, operationId: string): Promise<MaintenanceResult>;
}
