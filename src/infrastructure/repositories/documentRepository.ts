import type { DocumentRepository } from "@/domain/document/document.repository";
import type { DocumentInput, HouseDocument } from "@/domain/document/document.types";
import type { RestClient } from "@/infrastructure/api/restClient";

interface DocumentRow {
  id: string;
  title: string;
  category: string | null;
  visibility: "private" | "shared";
  expiry_date: string | null;
  reminder_enabled: boolean;
  owner_id: string;
  mime_type: string;
  file_name: string;
  file_size: number;
  revision: number;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
  can_delete: boolean;
  can_change_visibility: boolean;
}

function mapDocument(row: DocumentRow): HouseDocument {
  return {
    id: row.id, title: row.title, category: row.category ?? null,
    visibility: row.visibility, expiryDate: row.expiry_date ?? null,
    reminderEnabled: row.reminder_enabled === true, ownerId: row.owner_id,
    mimeType: row.mime_type, fileName: row.file_name, fileSize: row.file_size,
    revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    canEdit: row.can_edit === true, canDelete: row.can_delete === true,
    canChangeVisibility: row.can_change_visibility === true,
  };
}

export class RestDocumentRepository implements DocumentRepository {
  constructor(private readonly client: RestClient) {}

  async list(): Promise<HouseDocument[]> {
    const rows = await this.client.get<DocumentRow[]>("/documents", { cache: "no-store" });
    return (rows ?? []).map(mapDocument);
  }

  async add(input: DocumentInput, file: File): Promise<HouseDocument> {
    const form = new FormData();
    form.append("title", input.title.trim());
    if (input.category?.trim()) form.append("category", input.category.trim());
    form.append("visibility", input.visibility);
    if (input.expiryDate) form.append("expiry_date", input.expiryDate);
    form.append("reminder_enabled", String(input.reminderEnabled));
    form.append("file", file);
    return mapDocument(await this.client.postForm<DocumentRow>("/documents", form,
      { timeoutMs: 60000, cache: "no-store" }));
  }

  async update(id: string, input: DocumentInput, baseRevision: number): Promise<HouseDocument> {
    return mapDocument(await this.client.patch<DocumentRow>(`/documents/${encodeURIComponent(id)}`, {
      base_revision: baseRevision, title: input.title.trim(), category: input.category?.trim() || null,
      visibility: input.visibility, expiry_date: input.expiryDate ?? null,
      reminder_enabled: input.reminderEnabled,
    }, { cache: "no-store" }));
  }

  async remove(id: string, baseRevision: number): Promise<void> {
    await this.client.del<void>(`/documents/${encodeURIComponent(id)}?base_revision=${encodeURIComponent(baseRevision)}`,
      { cache: "no-store" });
  }

  download(id: string): Promise<Blob> {
    return this.client.getBlob(`/documents/${encodeURIComponent(id)}/file`,
      { timeoutMs: 60000, cache: "no-store" });
  }
}
