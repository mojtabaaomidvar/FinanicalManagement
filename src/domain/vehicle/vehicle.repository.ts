import type { Vehicle, VehicleInput, VehicleList, VehicleMaintenanceRecord, VehicleServiceInput, VehicleServiceResult } from "./vehicle.types";
export interface VehicleRepository {
  list(): Promise<VehicleList>;
  add(input: VehicleInput): Promise<Vehicle>;
  update(id: string, input: VehicleInput, baseRevision: number): Promise<Vehicle>;
  remove(id: string, baseRevision: number): Promise<void>;
  listServices(id: string): Promise<VehicleMaintenanceRecord[]>;
  addService(id: string, input: VehicleServiceInput, baseRevision: number, operationId: string): Promise<VehicleServiceResult>;
}
