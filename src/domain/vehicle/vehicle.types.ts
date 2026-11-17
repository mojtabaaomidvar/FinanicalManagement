/** Vehicle records are fetched online with server-defined field capabilities. */
export interface Vehicle {
  id: string; title: string; brand: string | null; model: string | null;
  plate: string | null; purchaseDate: string | null; odometer: number;
  insuranceUntil: string | null; inspectionUntil: string | null;
  documentId: string | null; serviceTaskId: string | null;
  serviceDueDate: string | null; serviceDueOdometer: number | null;
  serviceReminderEnabled: boolean; createdBy: string | null; revision: number;
  createdAt: string; updatedAt: string; canEdit: boolean; canDelete: boolean; canViewHistory: boolean;
}
export interface VehicleList { vehicles: Vehicle[]; canCreate: boolean }
export interface VehicleInput {
  title: string; brand?: string | null; model?: string | null; plate?: string | null;
  purchaseDate?: string | null; odometer: number;
  insuranceUntil?: string | null; inspectionUntil?: string | null;
  documentId?: string | null; serviceTaskId?: string | null;
  serviceDueDate?: string | null; serviceDueOdometer?: number | null; serviceReminderEnabled: boolean;
}
export interface VehicleMaintenanceRecord {
  id: string; vehicleId: string; performedOn: string; description: string;
  performedOdometer: number; nextDueDate: string | null; nextDueOdometer: number | null;
  transactionId: string | null; costAmount: number | null; costStatus: "none" | "recorded" | "unavailable";
  createdBy: string | null; createdAt: string;
}
export interface VehicleServiceInput {
  performedOn: string; description: string; performedOdometer: number;
  nextDueDate?: string | null; nextDueOdometer?: number | null;
  costAmount?: number | null; accountId?: string | null;
}
export interface VehicleServiceResult { vehicle: Vehicle; record: VehicleMaintenanceRecord; replayed: boolean }
