import { describe, expect, it } from "vitest";
import { ActivitySession } from "./activitySession";

describe("activity request session lifecycle", () => {
  it("rejects an old account's pending request when the identity or family changes", () => {
    const session = new ActivitySession(); session.setScope("member:family:member");
    const request = session.capture(); session.setScope("other:family:member"); expect(session.isCurrent(request)).toBe(false);
    const second = session.capture(); session.setScope("other:other-family:member"); expect(session.isCurrent(second)).toBe(false);
  });
  it("discards responses from before a disconnect even after the same account reconnects", () => {
    const session = new ActivitySession(); session.setScope("member:family:member"); const old = session.capture();
    session.invalidate(); session.setScope(""); session.setScope("member:family:member");
    expect(session.isCurrent(old)).toBe(false); expect(session.isCurrent(session.capture())).toBe(true);
  });
  it("revokes the existing form generation if the current manager role changes", () => {
    const session = new ActivitySession(); session.setScope("member:family:admin"); const edit = session.capture();
    session.setScope("member:family:member"); expect(session.isCurrent(edit)).toBe(false);
  });
  it("invalidates every previous snapshot on permission denial and all requests on unmount", () => {
    const session = new ActivitySession(); session.setScope("member:family:member"); const authorized = session.capture();
    session.invalidate(); expect(session.isCurrent(authorized)).toBe(false);
    const request = session.capture(); session.close(); expect(session.isCurrent(request)).toBe(false); expect(session.isCurrent(session.capture())).toBe(false);
  });
});
