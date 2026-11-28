export function scanReleaseHistory(source: string): { entries: { annotationId: string; text: string; line: number; context: string }[]; excluded: never[]; needsReview: never[] };
