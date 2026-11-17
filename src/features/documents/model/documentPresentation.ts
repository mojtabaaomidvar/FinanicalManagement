import type { HouseDocument } from "@/domain/document/document.types";

export type DocumentFilter = "all" | "private" | "shared" | "expiring" | "expired";

export function documentDaysRemaining(document: HouseDocument, todayIso: string): number | null {
  if (!document.expiryDate) return null;
  return Math.round((Date.parse(`${document.expiryDate}T00:00:00Z`) -
    Date.parse(`${todayIso}T00:00:00Z`)) / 86400000);
}

export function filterDocuments(
  documents: HouseDocument[], filter: DocumentFilter, query: string, todayIso: string,
): HouseDocument[] {
  const term = query.trim().toLocaleLowerCase("fa");
  return documents.filter((document) => {
    if (term && ![document.title, document.category ?? "", document.fileName]
      .some((value) => value.toLocaleLowerCase("fa").includes(term))) return false;
    if (filter === "private" || filter === "shared") return document.visibility === filter;
    const remaining = documentDaysRemaining(document, todayIso);
    if (filter === "expired") return remaining !== null && remaining < 0;
    if (filter === "expiring") return remaining !== null && remaining >= 0 && remaining <= 30;
    return true;
  });
}

export function documentExpiryLabel(document: HouseDocument, todayIso: string): string {
  const remaining = documentDaysRemaining(document, todayIso);
  if (remaining === null) return "بدون تاریخ اعتبار";
  if (remaining < 0) return "اعتبار تمام شده";
  if (remaining === 0) return "اعتبار تا امروز";
  if (remaining <= 30) return "رو به پایان";
  return "معتبر";
}
