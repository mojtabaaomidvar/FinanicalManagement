/** Document metadata is available only from an authenticated online request. */
export type DocumentVisibility = "private" | "shared";

export interface HouseDocument {
  id: string;
  title: string;
  category: string | null;
  visibility: DocumentVisibility;
  expiryDate: string | null;
  reminderEnabled: boolean;
  ownerId: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** These capabilities come from server authorization, never a client role. */
  canEdit: boolean;
  canDelete: boolean;
  canChangeVisibility: boolean;
}

export interface DocumentInput {
  title: string;
  category?: string | null;
  visibility: DocumentVisibility;
  expiryDate?: string | null;
  reminderEnabled: boolean;
}
