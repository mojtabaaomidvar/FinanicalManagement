import { describe, expect, it, vi } from "vitest";
import { defaultHomePreferences } from "@/domain/home/homePreferences.rules";
import type { HomePreferencesSnapshot } from "@/domain/home/homePreferences.types";
import { HomePreferenceSession, homePreferenceCacheKey } from "./homePreferenceSession";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) };
  const api = { get: vi.fn(async (): Promise<HomePreferencesSnapshot> => ({ revision: 0, preferences: null })),
    set: vi.fn(async (revision, preferences): Promise<HomePreferencesSnapshot> => ({ revision: revision + 1, preferences })) };
  const key = homePreferenceCacheKey("family", "owner");
  return { values, storage, api, key, session: new HomePreferenceSession(api, key, storage) };
}
const pinned = (id: string) => ({ ...defaultHomePreferences(), pins: [id] });

describe("personal Home persistence", () => {
  it("loads the account without writing default preferences to the server", async () => {
    const { session, api } = fixture();
    session.activate(false);
    expect(session.getSnapshot().ready).toBe(false);
    await settle();
    expect(session.getSnapshot().preferences).toEqual(defaultHomePreferences());
    expect(session.getSnapshot().ready).toBe(true);
    expect(api.set).not.toHaveBeenCalled();
  });

  it("serializes rapid changes and keeps the newest local choice", async () => {
    const { session, api } = fixture();
    session.activate(false); await settle();
    const first = deferred<HomePreferencesSnapshot>();
    api.set.mockImplementationOnce(() => first.promise);
    session.change(pinned("bills"));
    session.change(pinned("goals"));
    expect(api.set).toHaveBeenCalledTimes(1);
    first.resolve({ revision: 1, preferences: pinned("bills") });
    await settle();
    expect(api.set.mock.calls[1]).toEqual([1, pinned("goals")]);
    expect(session.getSnapshot().preferences.pins).toEqual(["goals"]);
    expect(session.getSnapshot().pending).toBe(false);
  });

  it("does not save an unchanged arrangement", async () => {
    const { session, api, storage } = fixture();
    session.activate(false); await settle();
    storage.setItem.mockClear();
    session.change(defaultHomePreferences());
    expect(api.set).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("retains offline choices across reopening then syncs against their base revision", async () => {
    const { session, api, key, storage } = fixture();
    session.activate(false); await settle();
    session.dispose(); session.activate(true);
    session.change(pinned("docs")); session.dispose();
    const reopened = new HomePreferenceSession(api, key, storage);
    reopened.activate(false); await settle();
    expect(api.set).toHaveBeenCalledWith(0, pinned("docs"));
    expect(reopened.getSnapshot().pending).toBe(false);
  });

  it("does not silently overwrite another device after offline edits", async () => {
    const { session, api } = fixture();
    session.activate(true); session.change(pinned("docs"));
    api.get.mockResolvedValue({ revision: 3, preferences: pinned("goals") });
    session.dispose(); session.activate(false); await settle();
    expect(session.getSnapshot().conflict).toBe(true);
    expect(session.getSnapshot().preferences.pins).toEqual(["docs"]);
    expect(api.set).not.toHaveBeenCalled();
    session.retry(); await settle();
    expect(api.set).toHaveBeenCalledWith(3, pinned("docs"));
    expect(session.getSnapshot().conflict).toBe(false);
  });

  it("detects CAS conflict and fetches the latest revision on explicit retry", async () => {
    const { session, api } = fixture();
    session.activate(false); await settle();
    api.set.mockRejectedValueOnce({ status: 409 });
    api.get.mockResolvedValue({ revision: 1, preferences: pinned("bills") });
    session.change(pinned("meals")); await settle();
    expect(session.getSnapshot().conflict).toBe(true);
    api.get.mockResolvedValue({ revision: 1, preferences: pinned("bills") });
    session.retry(); await settle();
    expect(api.set.mock.calls[1]).toEqual([1, pinned("meals")]);
  });

  it("recognizes a successful write whose response was lost", async () => {
    const { session, api } = fixture();
    session.activate(false); await settle();
    api.set.mockRejectedValueOnce(new Error("network"));
    session.change(pinned("meals")); await settle();
    api.get.mockResolvedValue({ revision: 1, preferences: pinned("meals") });
    session.retry(); await settle();
    expect(api.set).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().pending).toBe(false);
    expect(session.getSnapshot().error).toBeNull();
  });

  it("ignores a late load after account departure, including cache writes", async () => {
    const { session, api, storage } = fixture();
    const load = deferred<HomePreferencesSnapshot>(); api.get.mockReturnValueOnce(load.promise);
    session.activate(false); session.dispose();
    load.resolve({ revision: 9, preferences: pinned("accounts") }); await settle();
    expect(session.getSnapshot().ready).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("ignores an old write and never queues its next write after departure", async () => {
    const { session, api, storage } = fixture();
    session.activate(false); await settle();
    const write = deferred<HomePreferencesSnapshot>(); api.set.mockReturnValueOnce(write.promise);
    session.change(pinned("accounts")); session.change(pinned("bills"));
    session.dispose(); storage.setItem.mockClear();
    write.resolve({ revision: 1, preferences: pinned("accounts") }); await settle();
    expect(api.set).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("survives StrictMode reactivation without adopting the first stale response", async () => {
    const { session, api } = fixture();
    const first = deferred<HomePreferencesSnapshot>(); api.get.mockReturnValueOnce(first.promise);
    session.activate(false); session.dispose();
    api.get.mockResolvedValue({ revision: 2, preferences: pinned("pets") });
    session.activate(false); await settle();
    first.resolve({ revision: 1, preferences: pinned("children") }); await settle();
    expect(session.getSnapshot().preferences.pins).toEqual(["pets"]);
  });

  it("isolates caches by both account and household without storing records", () => {
    const { session, api, storage, key, values } = fixture();
    session.activate(true); session.change(pinned("vehicles"));
    const other = new HomePreferenceSession(api, homePreferenceCacheKey("family", "member"), storage);
    other.activate(true);
    expect(other.getSnapshot().preferences).toEqual(defaultHomePreferences());
    expect(homePreferenceCacheKey("other", "owner")).not.toBe(key);
    expect(Object.keys(JSON.parse(values.get(key)!))).toEqual(["revision", "preferences", "pending", "receipts"]);
  });

  it("keeps navigation working when storage is unavailable, reporting unsaved offline changes", () => {
    const { api, key } = fixture();
    const session = new HomePreferenceSession(api, key);
    session.activate(true); session.change(pinned("shopping"));
    expect(session.getSnapshot().preferences.pins).toEqual(["shopping"]);
    expect(session.getSnapshot().error).toContain("دستگاه");
    expect(api.set).not.toHaveBeenCalled();
  });

  it("recognizes its own delayed earlier save after a newer edit and reopening Home", async () => {
    const { session, api, storage, key } = fixture();
    session.activate(false); await settle();
    const first = deferred<HomePreferencesSnapshot>(); api.set.mockReturnValueOnce(first.promise);
    session.change(pinned("accounts")); session.change(pinned("bills")); session.dispose();
    first.resolve({ revision: 1, preferences: pinned("accounts") }); await settle();
    api.get.mockResolvedValue({ revision: 1, preferences: pinned("accounts") });
    const reopened = new HomePreferenceSession(api, key, storage);
    reopened.activate(false); await settle();
    expect(api.set.mock.calls[1]).toEqual([1, pinned("bills")]);
    expect(reopened.getSnapshot().pending).toBe(false);
    expect(reopened.getSnapshot().conflict).toBe(false);
  });

  it("recovers a CAS collision with its own still-running write across reconnect", async () => {
    const { session, api } = fixture();
    session.activate(false); await settle();
    const first = deferred<HomePreferencesSnapshot>(); api.set.mockReturnValueOnce(first.promise);
    session.change(pinned("accounts")); session.change(pinned("bills"));
    session.dispose(); session.activate(true);
    // The first GET arrives before the old request commits, then that request wins the CAS.
    api.get.mockResolvedValueOnce({ revision: 0, preferences: null })
      .mockResolvedValue({ revision: 1, preferences: pinned("accounts") });
    api.set.mockRejectedValueOnce({ status: 409 });
    session.dispose(); session.activate(false); await settle(); await settle();
    expect(api.set.mock.calls[2]).toEqual([1, pinned("bills")]);
    expect(session.getSnapshot().conflict).toBe(false);
    first.resolve({ revision: 1, preferences: pinned("accounts") }); await settle();
    expect(session.getSnapshot().preferences.pins).toEqual(["bills"]);
  });
});
