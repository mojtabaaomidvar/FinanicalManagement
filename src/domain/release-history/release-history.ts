export const RELEASE_COMPONENTS = ["pwa", "api", "management"] as const;
export const NOTE_GROUPS = ["features", "improvements", "fixes"] as const;
export type ReleaseComponent = typeof RELEASE_COMPONENTS[number];
export type NoteGroup = typeof NOTE_GROUPS[number];
export type ReleaseNote = { id: string; text: string };
export type UserReleaseNotes = { summary: string } & Record<NoteGroup, ReleaseNote[]>;
export type PublicRelease = {
  id: string;
  component: ReleaseComponent;
  version: string;
  released_on?: string;
  notes_status: "complete" | "partial";
  user_notes: UserReleaseNotes | null;
};
export type Release = PublicRelease & { technical_notes: ReleaseNote[] };
export type DisplayRelease = PublicRelease & { technical_notes?: ReleaseNote[] };
export type ReleaseHistory = { schema_version: 1; releases: Release[] };
export type CopySource = { id: string; text: string; file: string; line: number; context: string };
export type ReleaseHistoryData = { releases: DisplayRelease[]; sources: Record<string, CopySource> };

const versionPattern = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const noteIdPattern = /^[a-z][a-z0-9-]{0,95}$/;
const fail = (): never => { throw new Error("Invalid release history contract"); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
};
const keys = (value: Record<string, unknown>, allowed: string[], required = allowed) => {
  if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail();
};
const text = (value: unknown) => {
  if (typeof value !== "string" || value.length > 16000 || value.includes("\0")) fail();
};

export const isReleaseVersion = (value: unknown): value is string => typeof value === "string" && versionPattern.test(value);
export const compareReleaseVersions = (left: string, right: string): number => {
  if (!isReleaseVersion(left) || !isReleaseVersion(right)) return fail();
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
export const summaryCopyId = (releaseId: string) => `release-history.${releaseId}.summary`;
export const noteCopyId = (releaseId: string, noteId: string) => `release-history.${releaseId}.notes.${noteId}`;

export const validateReleaseHistory = (value: unknown): ReleaseHistory => {
  const history = object(value);
  keys(history, ["schema_version", "releases"]);
  if (history.schema_version !== 1 || !Array.isArray(history.releases) || history.releases.length > 1000) return fail();
  const ids = new Set<string>();
  for (const item of history.releases) {
    const release = object(item);
    keys(release, ["id", "component", "version", "released_on", "notes_status", "user_notes", "technical_notes"],
      ["id", "component", "version", "notes_status", "user_notes", "technical_notes"]);
    if (!RELEASE_COMPONENTS.includes(release.component as ReleaseComponent) || !isReleaseVersion(release.version)
      || release.id !== `${release.component}-${release.version}` || ids.has(release.id as string)
      || !["complete", "partial"].includes(release.notes_status as string)) return fail();
    ids.add(release.id as string);
    if (Object.hasOwn(release, "released_on")) {
      const day = release.released_on;
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return fail();
    }
    const noteIds = new Set<string>();
    const notes = (items: unknown) => {
      if (!Array.isArray(items) || items.length > 200) return fail();
      for (const item of items) {
        const note = object(item);
        keys(note, ["id", "text"]);
        if (typeof note.id !== "string" || !noteIdPattern.test(note.id) || noteIds.has(note.id)) return fail();
        noteIds.add(note.id); text(note.text);
      }
    };
    if (release.user_notes !== null) {
      const user = object(release.user_notes);
      keys(user, ["summary", ...NOTE_GROUPS]);
      text(user.summary);
      for (const group of NOTE_GROUPS) notes(user[group]);
    } else if (release.component === "pwa") return fail();
    notes(release.technical_notes);
  }
  return value as ReleaseHistory;
};

export const projectReleaseHistory = (history: ReleaseHistory, target: "pwa" | "management", version: string): DisplayRelease[] => {
  if (!isReleaseVersion(version)) return fail();
  return history.releases.filter(item => target === "management" || item.component === "pwa"
    && compareReleaseVersions(item.version, version) <= 0)
    .map(item => {
      const copy = structuredClone(item);
      if (target === "management") return copy;
      const { technical_notes: _technicalNotes, ...publicRelease } = copy;
      return publicRelease;
    })
    .sort((a, b) => RELEASE_COMPONENTS.indexOf(a.component) - RELEASE_COMPONENTS.indexOf(b.component)
      || compareReleaseVersions(b.version, a.version));
};

export const requireReleaseEntry = (history: ReleaseHistory, component: "pwa" | "management", version: string) => {
  if (!history.releases.some(item => item.component === component && item.version === version && item.notes_status === "complete")) {
    throw new Error(`Release history needs a complete entry for ${component} ${version}`);
  }
};
