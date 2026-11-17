import type { EquipmentRepository } from "@/domain/equipment/equipment.repository";
import type { Equipment, EquipmentInput, MaintenanceInput, MaintenanceRecord, MaintenanceResult } from "@/domain/equipment/equipment.types";
import type { RestClient, ReqOpts } from "@/infrastructure/api/restClient";
import type { TokenProvider } from "./sessionRepository";
import { AppError } from "@/shared/lib/appError";

interface EquipmentRow {
  id: string; title: string; brand: string | null; model: string | null;
  purchase_date: string | null; warranty_until: string | null;
  warranty_document_id: string | null; service_task_id: string | null;
  service_due_date: string | null; service_reminder_enabled: boolean;
  created_by: string | null; revision: number; created_at: string; updated_at: string;
  can_edit: boolean; can_delete: boolean;
}
interface MaintenanceRow {
  id: string; equipment_id: string; performed_on: string; description: string;
  next_due_date: string | null; created_by: string | null; created_at: string;
}

const mapEquipment = (row: EquipmentRow): Equipment => ({
  id: row.id, title: row.title, brand: row.brand ?? null, model: row.model ?? null,
  purchaseDate: row.purchase_date ?? null, warrantyUntil: row.warranty_until ?? null,
  warrantyDocumentId: row.warranty_document_id ?? null, serviceTaskId: row.service_task_id ?? null,
  serviceDueDate: row.service_due_date ?? null, serviceReminderEnabled: row.service_reminder_enabled === true,
  createdBy: row.created_by ?? null, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
  canEdit: row.can_edit === true, canDelete: row.can_delete === true,
});
const mapMaintenance = (row: MaintenanceRow): MaintenanceRecord => ({
  id: row.id, equipmentId: row.equipment_id, performedOn: row.performed_on,
  description: row.description, nextDueDate: row.next_due_date ?? null,
  createdBy: row.created_by ?? null, createdAt: row.created_at,
});
const equipmentBody = (input: EquipmentInput) => ({
  title: input.title.trim(), brand: input.brand?.trim() || null, model: input.model?.trim() || null,
  purchase_date: input.purchaseDate ?? null, warranty_until: input.warrantyUntil ?? null,
  warranty_document_id: input.warrantyDocumentId ?? null, service_task_id: input.serviceTaskId ?? null,
  service_due_date: input.serviceDueDate ?? null, service_reminder_enabled: input.serviceReminderEnabled,
});
const path = (id: string) => `/equipment/${encodeURIComponent(id)}`;

export class RestEquipmentRepository implements EquipmentRepository {
  constructor(private readonly client: RestClient, private readonly tokenProvider: TokenProvider) {}
  private async options(): Promise<ReqOpts> {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new AppError("NETWORK", "وسایل خانه به اتصال اینترنت نیاز دارد.");
    }
    // Bind the request to the session present when the operation began.
    const bearer = await this.tokenProvider.getToken();
    if (!bearer) throw new AppError("SESSION_EXPIRED", "نشست تغییر کرده است؛ صفحه را دوباره باز کنید.");
    return { bearer, cache: "no-store" };
  }
  async list(): Promise<Equipment[]> {
    return (await this.client.get<EquipmentRow[]>("/equipment", await this.options()) ?? []).map(mapEquipment);
  }
  async add(input: EquipmentInput): Promise<Equipment> {
    return mapEquipment(await this.client.post<EquipmentRow>("/equipment", equipmentBody(input), await this.options()));
  }
  async update(id: string, input: EquipmentInput, baseRevision: number): Promise<Equipment> {
    return mapEquipment(await this.client.patch<EquipmentRow>(path(id), { ...equipmentBody(input), base_revision: baseRevision }, await this.options()));
  }
  async remove(id: string, baseRevision: number): Promise<void> {
    await this.client.del<void>(`${path(id)}?base_revision=${encodeURIComponent(baseRevision)}`, await this.options());
  }
  async listMaintenance(id: string): Promise<MaintenanceRecord[]> {
    return (await this.client.get<MaintenanceRow[]>(`${path(id)}/services`, await this.options()) ?? []).map(mapMaintenance);
  }
  async addMaintenance(id: string, input: MaintenanceInput, baseRevision: number, operationId: string): Promise<MaintenanceResult> {
    const row = await this.client.post<{ equipment: EquipmentRow; record: MaintenanceRow; replayed: boolean }>(`${path(id)}/services`, {
      operation_id: operationId, base_revision: baseRevision,
      performed_on: input.performedOn, description: input.description.trim(), next_due_date: input.nextDueDate ?? null,
    }, await this.options());
    return { equipment: mapEquipment(row.equipment), record: mapMaintenance(row.record), replayed: row.replayed === true };
  }
}
