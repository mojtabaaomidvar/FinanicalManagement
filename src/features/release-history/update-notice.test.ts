import { describe, expect, it } from "vitest";
import { claimReleaseNotice, PENDING_RELEASE_UPDATE, rememberReleaseUpdate, SEEN_RELEASE_NOTICE } from "./update-notice";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
};
describe("device release notices", () => {
  it("does not invent an update on first install or ordinary reload", () => {
    const storage = memory();
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(false);
    rememberReleaseUpdate("0.11.0", storage);
    expect(claimReleaseNotice("0.11.0", true, storage)).toBe(false);
    expect(storage.getItem(PENDING_RELEASE_UPDATE)).toBe("0.11.0");
  });
  it("claims one notice after activation, including repeated upgrade after a rollback", () => {
    const storage = memory(); rememberReleaseUpdate("0.11.0", storage);
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(true);
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(false);
    rememberReleaseUpdate("0.11.0", storage);
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(false);
    rememberReleaseUpdate("0.12.0", storage);
    expect(claimReleaseNotice("0.13.0", true, storage)).toBe(true);
  });
  it("suppresses rollback, absent notes and corrupt local markers", () => {
    const storage = memory(); rememberReleaseUpdate("0.12.0", storage);
    expect(claimReleaseNotice("0.11.0", true, storage)).toBe(false);
    rememberReleaseUpdate("0.11.0", storage);
    expect(claimReleaseNotice("0.12.0", false, storage)).toBe(false);
    storage.setItem(PENDING_RELEASE_UPDATE, "corrupt");
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(false);
    expect(storage.getItem(SEEN_RELEASE_NOTICE)).toBeNull();
  });
  it("does not display a notice when persistent storage fails", () => {
    const storage = memory(); rememberReleaseUpdate("0.11.0", storage);
    storage.setItem = () => { throw new Error("storage disabled"); };
    expect(claimReleaseNotice("0.12.0", true, storage)).toBe(false);
    expect(() => rememberReleaseUpdate("0.12.0", storage)).not.toThrow();
  });
});
