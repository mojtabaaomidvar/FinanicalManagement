import { describe, expect, it } from "vitest";
import { ChildSession } from "./childSession";

describe("child snapshot and form lifecycle", () => {
  it("discards another member or family's pending detail responses", () => {
    const session = new ChildSession(); session.setScope("manager:family:admin");
    const detail = session.capture(); session.setScope("member:family:member"); expect(session.isCurrent(detail)).toBe(false);
    const next = session.capture(); session.setScope("member:other-family:member"); expect(session.isCurrent(next)).toBe(false);
  });
  it("does not restore snapshots after a disconnect and reconnect of the same account", () => {
    const session = new ChildSession(); session.setScope("manager:family:admin"); const pending = session.capture();
    session.invalidate(); session.setScope(""); session.setScope("manager:family:admin");
    expect(session.isCurrent(pending)).toBe(false); expect(session.isCurrent(session.capture())).toBe(true);
  });
  it("revokes an open manager form when the manager role changes", () => {
    const session = new ChildSession(); session.setScope("manager:family:admin"); const form = session.capture();
    session.setScope("manager:family:member"); expect(session.isCurrent(form)).toBe(false);
  });
  it("revokes every earlier ticket on denied access and closes all responses on unmount", () => {
    const session = new ChildSession(); session.setScope("manager:family:admin"); const list = session.capture();
    session.invalidate(); expect(session.isCurrent(list)).toBe(false);
    const save = session.capture(); session.close(); expect(session.isCurrent(save)).toBe(false);
    expect(session.isCurrent(session.capture())).toBe(false);
  });
});
