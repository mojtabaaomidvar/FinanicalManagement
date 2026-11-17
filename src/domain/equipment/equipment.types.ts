/** Shared equipment and non-financial maintenance are available only online. */
export interface Equipment {
  id: string;
  title: string;
  brand: string | null;
  model: string | null;
  purchaseDate: string | null;
  warrantyUntil: string | null;
  warrantyDocumentId: string | null;
  serviceTaskId: string | null;
  serviceDueDate: string | null;
  serviceReminderEnabled: boolean;
  createdBy: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface EquipmentInput {
  title: string;
  brand?: string | null;
  model?: string | null;
  purchaseDate?: string | null;
  warrantyUntil?: string | null;
  warrantyDocumentId?: string | null;
  serviceTaskId?: string | null;
  serviceDueDate?: string | null;
  serviceReminderEnabled: boolean;
}

export interface MaintenanceRecord {
  id: string;
  equipmentId: string;
  performedOn: string;
  description: string;
  nextDueDate: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MaintenanceInput {
  performedOn: string;
  description: string;
  nextDueDate?: string | null;
}

export interface MaintenanceResult {
  equipment: Equipment;
  record: MaintenanceRecord;
  replayed: boolean;
}
