import type { DocumentRepository } from "@/domain/document/document.repository";
import type { DocumentInput, HouseDocument } from "@/domain/document/document.types";
import { validateDocumentDownload, validateDocumentFile, validateDocumentInput } from "@/domain/document/document.rules";

export class ListDocumentsUseCase {
  constructor(private readonly repo: DocumentRepository) {}
  execute(): Promise<HouseDocument[]> { return this.repo.list(); }
}

export class AddDocumentUseCase {
  constructor(private readonly repo: DocumentRepository) {}
  execute(input: DocumentInput, file: File): Promise<HouseDocument> {
    validateDocumentInput(input);
    validateDocumentFile(file);
    return this.repo.add(input, file);
  }
}

export class UpdateDocumentUseCase {
  constructor(private readonly repo: DocumentRepository) {}
  execute(id: string, input: DocumentInput, baseRevision: number): Promise<HouseDocument> {
    validateDocumentInput(input);
    return this.repo.update(id, input, baseRevision);
  }
}

export class DeleteDocumentUseCase {
  constructor(private readonly repo: DocumentRepository) {}
  execute(id: string, baseRevision: number): Promise<void> {
    return this.repo.remove(id, baseRevision);
  }
}

export class DownloadDocumentUseCase {
  constructor(private readonly repo: Pick<DocumentRepository, "download">) {}
  async execute(id: string): Promise<Blob> {
    const blob = await this.repo.download(id);
    validateDocumentDownload(blob);
    return blob;
  }
}
