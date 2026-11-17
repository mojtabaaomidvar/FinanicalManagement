import type { HomePreferences, HomePreferencesSnapshot } from "@/domain/home/homePreferences.types";
import { defaultHomePreferences, normalizeHomePreferences } from "@/domain/home/homePreferences.rules";

interface HomePreferenceApi {
  get(): Promise<HomePreferencesSnapshot>;
  set(revision: number, preferences: HomePreferences): Promise<HomePreferencesSnapshot>;
}

export interface HomePreferenceState {
  preferences: HomePreferences;
  ready: boolean;
  saving: boolean;
  pending: boolean;
  error: string | null;
  conflict: boolean;
}

type Receipt = { revision: number; preferences: HomePreferences };
type Cache = { revision: number; preferences: HomePreferences; pending: boolean; receipts?: Receipt[] };
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
const same = (a: HomePreferences, b: HomePreferences) => JSON.stringify(a) === JSON.stringify(b);

/** A cache contains navigation IDs only. No names, records, photos or session tokens. */
export function homePreferenceCacheKey(familyId: string, memberId: string): string {
  return `khaneyar:home:v1:${encodeURIComponent(familyId)}:${encodeURIComponent(memberId)}`;
}

export class HomePreferenceSession {
  private state: HomePreferenceState;
  private revision = 0;
  private active = false;
  private restricted = true;
  private generation = 0;
  private receipts: Receipt[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly api: HomePreferenceApi, private readonly key: string,
    private readonly storage?: PreferenceStorage) {
    let cache: Cache | undefined;
    try {
      const saved = JSON.parse(storage?.getItem(key) ?? "null") as Cache | null;
      if (saved && Number.isSafeInteger(saved.revision) && saved.revision >= 0) cache = saved;
    } catch { /* A damaged/unavailable cache must not affect navigation. */ }
    this.revision = cache?.revision ?? 0;
    this.receipts = (Array.isArray(cache?.receipts) ? cache.receipts : []).slice(-8)
      .filter((receipt) => receipt && Number.isSafeInteger(receipt.revision) && receipt.revision >= 0)
      .map((receipt) => ({ revision: receipt.revision, preferences: normalizeHomePreferences(receipt.preferences) }));
    this.state = {
      preferences: normalizeHomePreferences(cache?.preferences),
      pending: cache?.pending === true,
      ready: false, saving: false, error: null, conflict: false,
    };
  }

  getSnapshot = (): HomePreferenceState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** May activate again after React StrictMode's setup/cleanup cycle. */
  activate(restricted: boolean): void {
    this.active = true;
    this.restricted = restricted;
    const generation = ++this.generation;
    this.publish({ saving: false, ready: restricted, error: null, conflict: false });
    if (!restricted) void this.load(generation, false);
  }

  dispose(): void {
    this.active = false;
    ++this.generation;
  }

  change = (preferences: HomePreferences): void => {
    if (!this.active || !this.state.ready) return;
    const next = normalizeHomePreferences(preferences);
    if (same(next, this.state.preferences)) return;
    this.publish({ preferences: next, pending: true });
    this.cache();
    this.flush();
  };

  reset = (): void => { this.change(defaultHomePreferences()); };

  retry = (): void => {
    if (!this.active || this.restricted || this.state.saving) return;
    const overwrite = this.state.conflict;
    const generation = ++this.generation;
    this.publish({ error: null, conflict: false, ready: false });
    void this.load(generation, overwrite);
  };

  private current(generation: number): boolean {
    return this.active && !this.restricted && this.generation === generation;
  }

  private publish(change: Partial<HomePreferenceState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private cache(): void {
    try {
      if (!this.storage) throw new Error("storage unavailable");
      this.storage.setItem(this.key, JSON.stringify({
        revision: this.revision, preferences: this.state.preferences, pending: this.state.pending, receipts: this.receipts,
      }));
    } catch {
      if (this.restricted && this.state.pending) this.publish({
        error: "ذخیرهٔ چیدمان روی این دستگاه ممکن نیست؛ پس از اتصال دوباره تلاش کن.",
      });
    }
  }

  private async load(generation: number, overwrite: boolean): Promise<void> {
    try {
      const remote = await this.api.get();
      if (!this.current(generation)) return;
      const preferences = normalizeHomePreferences(remote.preferences);
      if (this.state.pending && !same(this.state.preferences, preferences)) {
        // Navigation or connectivity may have hidden an acknowledgement of our own earlier write.
        const ownWrite = this.receipts.some((receipt) => receipt.revision + 1 === remote.revision
          && same(receipt.preferences, preferences));
        if (remote.revision !== this.revision && !overwrite && !ownWrite) {
          this.publish({ ready: true, conflict: true,
            error: "چیدمان حسابت در دستگاه دیگری تغییر کرده است. برای جایگزینی آن، «ذخیرهٔ چیدمان من» را بزن." });
          return;
        }
        this.revision = remote.revision;
        this.receipts = this.receipts.filter((receipt) => receipt.revision >= remote.revision);
        this.publish({ ready: true, error: null, conflict: false });
        this.cache();
        this.flush();
      } else {
        this.revision = remote.revision;
        this.receipts = [];
        this.publish({ preferences, ready: true, pending: false, error: null, conflict: false });
        this.cache();
      }
    } catch {
      if (!this.current(generation)) return;
      this.publish({ ready: false,
        error: "چیدمان حسابت دریافت نشد؛ برای تغییر و ذخیرهٔ آن دوباره تلاش کن." });
    }
  }

  /** Serialize writes; a late response cannot replace a newer local arrangement. */
  private flush(): void {
    if (!this.active || this.restricted || !this.state.ready || !this.state.pending
      || this.state.saving || this.state.error) return;
    const generation = this.generation;
    const sent = normalizeHomePreferences(this.state.preferences);
    if (!this.receipts.some((receipt) => receipt.revision === this.revision && same(receipt.preferences, sent))) {
      this.receipts = [...this.receipts, { revision: this.revision, preferences: sent }].slice(-8);
    }
    this.publish({ saving: true });
    this.cache();
    void this.api.set(this.revision, sent).then((remote) => {
      if (!this.current(generation)) return;
      this.revision = remote.revision;
      this.receipts = this.receipts.filter((receipt) => receipt.revision >= remote.revision);
      const pending = !same(sent, this.state.preferences);
      this.publish({ saving: false, pending, error: null, conflict: false });
      this.cache();
      if (pending) this.flush();
    }).catch((error: unknown) => {
      if (!this.current(generation)) return;
      const conflict = (error as { status?: number })?.status === 409;
      if (conflict) {
        this.publish({ saving: false, ready: false });
        // Resolve our own delayed write before asking the user about another device.
        void this.load(generation, false);
        return;
      }
      this.publish({ saving: false, conflict,
        error: conflict
          ? "چیدمان حسابت در دستگاه دیگری تغییر کرده است. برای جایگزینی آن، «ذخیرهٔ چیدمان من» را بزن."
          : "چیدمان هنوز در حسابت ذخیره نشده است؛ دوباره تلاش کن." });
      this.cache();
    });
  }
}
