import { describe, expect, it } from "vitest";
import type { HouseDocument } from "@/domain/document/document.types";
import { documentDaysRemaining, documentExpiryLabel, filterDocuments } from "./documentPresentation";
import { MAX_DOCUMENT_FILE_SIZE, validateDocumentDownload, validateDocumentFile, validateDocumentInput } from "@/domain/document/document.rules";
import { DownloadDocumentUseCase } from "@/application/document/document.usecases";
import type { DocumentRepository } from "@/domain/document/document.repository";

const document: HouseDocument = {
  id: "one", title: "ضمانت یخچال", category: "ضمانت", visibility: "private",
  expiryDate: "2026-11-14", reminderEnabled: true, ownerId: "owner",
  mimeType: "application/pdf", fileName: "warranty.pdf", fileSize: 100,
  revision: 1, createdAt: "2026-11-13T08:00:00Z", updatedAt: "2026-11-13T08:00:00Z",
  canEdit: true, canDelete: true, canChangeVisibility: true,
};

describe("document expiry and filters", () => {
  it("keeps expiry today valid and crosses month and year boundaries by calendar days", () => {
    expect(documentDaysRemaining(document, "2026-11-14")).toBe(0);
    expect(documentExpiryLabel(document, "2026-11-14")).toBe("اعتبار تا امروز");
    expect(documentExpiryLabel(document, "2026-11-15")).toBe("اعتبار تمام شده");
    expect(documentDaysRemaining({ ...document, expiryDate: "2027-01-01" }, "2026-12-31")).toBe(1);
  });

  it("combines search and visibility without mixing private/shared rows", () => {
    const shared = { ...document, id: "two", visibility: "shared" as const };
    expect(filterDocuments([document, shared], "private", "ضمانت", "2026-11-14")).toEqual([document]);
    expect(filterDocuments([document, shared], "shared", "WARRANTY", "2026-11-14")).toEqual([shared]);
    expect(filterDocuments([document, shared], "all", "ناموجود", "2026-11-14")).toEqual([]);
  });

  it("includes today through 30 days in expiring, excludes expired and undated documents", () => {
    const boundary = { ...document, id: "boundary", expiryDate: "2026-12-14" };
    const later = { ...document, id: "later", expiryDate: "2026-12-15" };
    const expired = { ...document, id: "expired", expiryDate: "2026-11-13" };
    const undated = { ...document, id: "undated", expiryDate: null };
    const rows = [document, boundary, later, expired, undated];
    expect(filterDocuments(rows, "expiring", "", "2026-11-14")).toEqual([document, boundary]);
    expect(filterDocuments(rows, "expired", "", "2026-11-14")).toEqual([expired]);
  });
});

describe("document upload feedback", () => {
  it("rejects empty, oversized and unsupported files before uploading", () => {
    expect(() => validateDocumentFile({ type: "image/svg+xml", size: 100 })).toThrow();
    expect(() => validateDocumentFile({ type: "application/pdf", size: 0 })).toThrow();
    expect(() => validateDocumentFile({ type: "application/pdf", size: MAX_DOCUMENT_FILE_SIZE + 1 })).toThrow();
    expect(() => validateDocumentFile({ type: "application/pdf", size: MAX_DOCUMENT_FILE_SIZE })).not.toThrow();
  });

  it("rejects impossible expiry days and empty titles", () => {
    const input = { title: "سند", visibility: "private" as const, reminderEnabled: true };
    expect(() => validateDocumentInput({ ...input, expiryDate: "2026-02-30" })).toThrow();
    expect(() => validateDocumentInput({ ...input, title: "  " })).toThrow();
    expect(() => validateDocumentInput({ ...input, expiryDate: "2028-02-29" })).not.toThrow();
  });
});

describe("downloaded document protection", () => {
  it("rejects empty, error-MIME and oversized responses before returning downloadable bytes", async () => {
    for (const blob of [new Blob([], { type: "application/pdf" }),
      new Blob(['{"error":"denied"}'], { type: "application/json" }),
      new Blob([new Uint8Array(MAX_DOCUMENT_FILE_SIZE + 1)], { type: "image/png" })]) {
      const repo: Pick<DocumentRepository, "download"> = { download: async () => blob };
      await expect(new DownloadDocumentUseCase(repo).execute("document")).rejects.toThrow("دریافت فایل کامل نشد");
    }
  });

  it("accepts supported bytes and rejects a MIME or length mismatch with authorized metadata", async () => {
    const blob = new Blob(["%PDF-fixture"], { type: "application/pdf" });
    const repo: Pick<DocumentRepository, "download"> = { download: async () => blob };
    await expect(new DownloadDocumentUseCase(repo).execute("document")).resolves.toBe(blob);
    expect(() => validateDocumentDownload(blob, { mimeType: "application/pdf", fileSize: blob.size })).not.toThrow();
    expect(() => validateDocumentDownload(blob, { mimeType: "image/png", fileSize: blob.size })).toThrow();
    expect(() => validateDocumentDownload(blob, { mimeType: "application/pdf", fileSize: blob.size + 1 })).toThrow();
  });
});
