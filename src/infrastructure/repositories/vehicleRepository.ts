import type { VehicleRepository } from "@/domain/vehicle/vehicle.repository";
import type { Vehicle, VehicleInput, VehicleList, VehicleMaintenanceRecord, VehicleServiceInput, VehicleServiceResult } from "@/domain/vehicle/vehicle.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface VehicleRow {
  id: string; title: string; brand: string | null; model: string | null; plate: string | null;
  purchase_date: string | null; odometer: number; insurance_until: string | null; inspection_until: string | null;
  document_id: string | null; service_task_id: string | null; service_due_date: string | null; service_due_odometer: number | null;
  service_reminder_enabled: boolean; created_by: string | null; revision: number; created_at: string; updated_at: string;
  can_edit: boolean; can_delete: boolean; can_view_history: boolean;
}
interface ServiceRow {
  id: string; vehicle_id: string; performed_on: string; description: string; performed_odometer: number;
  next_due_date: string | null; next_due_odometer: number | null; transaction_id: string | null;
  cost_amount: string | number | null; cost_status: VehicleMaintenanceRecord["costStatus"]; created_by: string | null; created_at: string;
}
const mapVehicle = (row: VehicleRow): Vehicle => ({
  id: row.id, title: row.title, brand: row.brand ?? null, model: row.model ?? null, plate: row.plate ?? null,
  purchaseDate: row.purchase_date ?? null, odometer: row.odometer, insuranceUntil: row.insurance_until ?? null, inspectionUntil: row.inspection_until ?? null,
  documentId: row.document_id ?? null, serviceTaskId: row.service_task_id ?? null, serviceDueDate: row.service_due_date ?? null, serviceDueOdometer: row.service_due_odometer ?? null,
  serviceReminderEnabled: row.service_reminder_enabled === true, createdBy: row.created_by ?? null,
  revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  canEdit: row.can_edit === true, canDelete: row.can_delete === true, canViewHistory: row.can_view_history === true,
});
const mapRecord = (row: ServiceRow): VehicleMaintenanceRecord => ({
  id: row.id, vehicleId: row.vehicle_id, performedOn: row.performed_on, description: row.description, performedOdometer: row.performed_odometer,
  nextDueDate: row.next_due_date ?? null, nextDueOdometer: row.next_due_odometer ?? null,
  transactionId: row.transaction_id ?? null, costAmount: row.cost_amount === null || row.cost_amount === undefined ? null : Number(row.cost_amount),
  costStatus: row.cost_status, createdBy: row.created_by ?? null, createdAt: row.created_at,
});
const body = (input: VehicleInput) => ({
  title: input.title.trim(), brand: input.brand?.trim() || null, model: input.model?.trim() || null, plate: input.plate?.trim() || null,
  purchase_date: input.purchaseDate ?? null, odometer: input.odometer, insurance_until: input.insuranceUntil ?? null, inspection_until: input.inspectionUntil ?? null,
  document_id: input.documentId ?? null, service_task_id: input.serviceTaskId ?? null, service_due_date: input.serviceDueDate ?? null,
  service_due_odometer: input.serviceDueOdometer ?? null, service_reminder_enabled: input.serviceReminderEnabled,
});
const path = (id: string) => `/vehicles/${encodeURIComponent(id)}`;
export class RestVehicleRepository implements VehicleRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new AppError("NETWORK", "مدیریت خودرو به اتصال اینترنت نیاز دارد.");
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<VehicleList> {
    const row = await this.client.get<{ vehicles: VehicleRow[]; can_create: boolean }>("/vehicles", await this.options());
    return { vehicles: row.vehicles.map(mapVehicle), canCreate: row.can_create === true };
  }
  async add(input: VehicleInput): Promise<Vehicle> { return mapVehicle(await this.client.post<VehicleRow>("/vehicles", body(input), await this.options())); }
  async update(id: string, input: VehicleInput, baseRevision: number): Promise<Vehicle> { return mapVehicle(await this.client.patch<VehicleRow>(path(id), { ...body(input), base_revision: baseRevision }, await this.options())); }
  async remove(id: string, baseRevision: number): Promise<void> { await this.client.del<void>(`${path(id)}?base_revision=${encodeURIComponent(baseRevision)}`, await this.options()); }
  async listServices(id: string): Promise<VehicleMaintenanceRecord[]> { return (await this.client.get<ServiceRow[]>(`${path(id)}/services`, await this.options())).map(mapRecord); }
  async addService(id: string, input: VehicleServiceInput, baseRevision: number, operationId: string): Promise<VehicleServiceResult> {
    const row = await this.client.post<{ vehicle: VehicleRow; record: ServiceRow; replayed: boolean }>(`${path(id)}/services`, {
      operation_id: operationId, base_revision: baseRevision, performed_on: input.performedOn, description: input.description.trim(),
      performed_odometer: input.performedOdometer, next_due_date: input.nextDueDate ?? null, next_due_odometer: input.nextDueOdometer ?? null,
      cost_amount: input.costAmount ?? null, account_id: input.accountId ?? null,
    }, await this.options());
    return { vehicle: mapVehicle(row.vehicle), record: mapRecord(row.record), replayed: row.replayed === true };
  }
}
