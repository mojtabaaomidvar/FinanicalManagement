/** Deployment configuration, separate from editable display text and user data. */
export function isSupportHost(): boolean {
  const expected = (import.meta.env.VITE_SUPPORT_HOST ?? "").trim().toLowerCase();
  return Boolean(expected && typeof location !== "undefined" && location.hostname.toLowerCase() === expected);
}

export const householdAppUrl = (import.meta.env.VITE_APP_URL ?? "").trim() || "/";
