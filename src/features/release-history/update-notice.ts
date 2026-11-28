import { compareReleaseVersions, isReleaseVersion } from "@/domain/release-history/release-history";

export const PENDING_RELEASE_UPDATE = "khaneyar:release-history:pending-update";
export const SEEN_RELEASE_NOTICE = "khaneyar:release-history:seen-version";
type NoticeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const rememberReleaseUpdate = (version: string, storage: NoticeStorage): void => {
  if (!isReleaseVersion(version)) return;
  try { storage.setItem(PENDING_RELEASE_UPDATE, version); } catch { /* Optional device-only notice. */ }
};

/** Claim before showing, so re-renders and reloads cannot repeat a notice. */
export const claimReleaseNotice = (version: string, hasNotes: boolean, storage: NoticeStorage): boolean => {
  if (!isReleaseVersion(version)) return false;
  try {
    const previous = storage.getItem(PENDING_RELEASE_UPDATE);
    if (!isReleaseVersion(previous)) { if (previous !== null) storage.removeItem(PENDING_RELEASE_UPDATE); return false; }
    const comparison = compareReleaseVersions(version, previous);
    if (comparison === 0) return false; // The old service worker is still active.
    storage.removeItem(PENDING_RELEASE_UPDATE);
    if (comparison < 0 || !hasNotes) return false;
    const seen = storage.getItem(SEEN_RELEASE_NOTICE);
    if (isReleaseVersion(seen) && compareReleaseVersions(seen, version) >= 0) return false;
    storage.setItem(SEEN_RELEASE_NOTICE, version);
    return true;
  } catch { return false; }
};
