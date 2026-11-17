import type { DocumentInput, HouseDocument } from "./document.types";

export interface DocumentRepository {
  list(): Promise<HouseDocument[]>;
  add(input: DocumentInput, file: File): Promise<HouseDocument>;
  update(id: string, input: DocumentInput, baseRevision: number): Promise<HouseDocument>;
  remove(id: string, baseRevision: number): Promise<void>;
  download(id: string): Promise<Blob>;
}
