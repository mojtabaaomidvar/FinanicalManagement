import type { DocumentInput, HouseDocument } from "./document.types";

export const MAX_DOCUMENT_FILE_SIZE = 10 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp",
] as const;

/** Client validation gives immediate feedback; the server validates actual bytes. */
export function validateDocumentFile(file: { type: string; size: number }): void {
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error("یک فایل PDF یا عکس JPEG، PNG یا WebP انتخاب کنید.");
  }
  if (file.size <= 0) throw new Error("فایل انتخاب‌شده خالی است.");
  if (file.size > MAX_DOCUMENT_FILE_SIZE) throw new Error("حجم فایل باید حداکثر ۱۰ مگابایت باشد.");
}

/** An empty/error response must never become a downloadable document URL. */
export function validateDocumentDownload(
  file: { type: string; size: number }, expected?: Pick<HouseDocument, "mimeType" | "fileSize">,
): void {
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  if (!(DOCUMENT_MIME_TYPES as readonly string[]).includes(mime) || file.size <= 0 ||
    file.size > MAX_DOCUMENT_FILE_SIZE || expected &&
    (mime !== expected.mimeType || file.size !== expected.fileSize)) {
    throw new Error("دریافت فایل کامل نشد؛ دوباره تلاش کنید.");
  }
}

export function validateDocumentInput(input: DocumentInput): void {
  if (!input.title.trim()) throw new Error("عنوان سند را بنویسید.");
  if (input.title.trim().length > 120) throw new Error("عنوان سند باید حداکثر ۱۲۰ نویسه باشد.");
  if ((input.category?.trim().length ?? 0) > 80) throw new Error("دسته‌بندی باید حداکثر ۸۰ نویسه باشد.");
  if (input.visibility !== "private" && input.visibility !== "shared") {
    throw new Error("دسترسی سند را مشخص کنید.");
  }
  if (input.expiryDate) {
    const date = new Date(`${input.expiryDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate) || !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== input.expiryDate) {
      throw new Error("تاریخ اعتبار را دوباره انتخاب کنید.");
    }
  }
}
