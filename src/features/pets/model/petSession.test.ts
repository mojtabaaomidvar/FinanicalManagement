import { describe, expect, it } from "vitest";
import { PetSession } from "./petSession";

describe("pet snapshot and dialog lifecycle", () => {
  it("revokes pending reads when member or family changes", () => {
    const session = new PetSession(); session.setScope("manager:family:admin"); const detail = session.capture();
    session.setScope("member:family:member"); expect(session.isCurrent(detail)).toBe(false);
    const other = session.capture(); session.setScope("member:other-family:member"); expect(session.isCurrent(other)).toBe(false);
  });
  it("does not revive old pet data after the same account reconnects", () => {
    const session = new PetSession(); session.setScope("manager:family:admin"); const old = session.capture();
    session.invalidate(); session.setScope(""); session.setScope("manager:family:admin");
    expect(session.isCurrent(old)).toBe(false); expect(session.isCurrent(session.capture())).toBe(true);
  });
  it("revokes manager profile and care dialogs when role changes", () => {
    const session = new PetSession(); session.setScope("manager:family:admin"); const dialog = session.capture();
    session.setScope("manager:family:member"); expect(session.isCurrent(dialog)).toBe(false);
  });
  it("invalidates current snapshots on denial and pending responses on unmount", () => {
    const session = new PetSession(); session.setScope("manager:family:admin"); const list = session.capture();
    session.invalidate(); expect(session.isCurrent(list)).toBe(false);
    const save = session.capture(); session.close(); expect(session.isCurrent(save)).toBe(false); expect(session.isCurrent(session.capture())).toBe(false);
  });
});
