import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheNames } from "workbox-core/cacheNames.js";
import { setCacheNameDetails } from "workbox-core/setCacheNameDetails.js";
import { BrowserOfflineCache } from "./offlineCache.adapter";

afterEach(() => {
  vi.unstubAllGlobals();
  setCacheNameDetails({ suffix: "" });
});

function fakeCaches(names: string[]) {
  const stored = new Set(names);
  vi.stubGlobal("caches", {
    keys: async () => [...stored],
    delete: async (name: string) => stored.delete(name),
  });
  return stored;
}

describe("logout cache cleanup", () => {
  it("clears private data and retains the registered worker's static shell", async () => {
    const scope = "https://example.test/household/";
    setCacheNameDetails({ suffix: scope });
    const shell = cacheNames.precache;
    setCacheNameDetails({ suffix: "" });
    const stored = fakeCaches([shell, "api-data", "workbox-runtime-old"]);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ scope }) },
    });
    const privateData = new Map([["shopping-offline:family:member", "encrypted"]]);
    await new BrowserOfflineCache(async () => {
      privateData.clear();
      expect([...stored]).toContain("api-data");
    }).clear();

    expect(privateData.size).toBe(0);
    expect([...stored]).toEqual([shell]);
  });

  it("clears caches without service-worker support", async () => {
    const stored = fakeCaches(["api-data"]);
    vi.stubGlobal("navigator", {});
    await new BrowserOfflineCache().clear();
    expect(stored.size).toBe(0);
  });

  it("still clears other caches when private storage and worker lookup fail", async () => {
    const stored = fakeCaches(["api-data"]);
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => { throw new Error("unavailable"); } },
    });
    await expect(new BrowserOfflineCache(async () => {
      throw new Error("storage unavailable");
    }).clear()).resolves.toBeUndefined();
    expect(stored.size).toBe(0);
  });

  it("clears private data without CacheStorage", async () => {
    vi.stubGlobal("caches", undefined);
    const clearPrivate = vi.fn(async () => {});
    await new BrowserOfflineCache(clearPrivate).clear();
    expect(clearPrivate).toHaveBeenCalledOnce();
  });
});
