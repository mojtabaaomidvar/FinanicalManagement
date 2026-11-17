import type { VehicleRepository } from "@/domain/vehicle/vehicle.repository";
import type { VehicleInput, VehicleServiceInput } from "@/domain/vehicle/vehicle.types";
export class ListVehiclesUseCase { constructor(private readonly repo: VehicleRepository) {} execute() { return this.repo.list(); } }
export class AddVehicleUseCase { constructor(private readonly repo: VehicleRepository) {} execute(input: VehicleInput) { return this.repo.add(input); } }
export class UpdateVehicleUseCase { constructor(private readonly repo: VehicleRepository) {} execute(id: string, input: VehicleInput, baseRevision: number) { return this.repo.update(id, input, baseRevision); } }
export class DeleteVehicleUseCase { constructor(private readonly repo: VehicleRepository) {} execute(id: string, baseRevision: number) { return this.repo.remove(id, baseRevision); } }
export class ListVehicleServicesUseCase { constructor(private readonly repo: VehicleRepository) {} execute(id: string) { return this.repo.listServices(id); } }
export class AddVehicleServiceUseCase { constructor(private readonly repo: VehicleRepository) {} execute(id: string, input: VehicleServiceInput, baseRevision: number, operationId: string) { return this.repo.addService(id, input, baseRevision, operationId); } }
