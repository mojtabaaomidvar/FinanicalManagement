import { afterEach, describe, expect, it, vi } from "vitest";
import { PetCareOperation } from "./petCareOperation";

afterEach(() => vi.unstubAllGlobals());
const input = { title: "غذا دادن", assigneeId: "member", dueDate: "2026-11-15" };
function operation() {
  let index = 0; vi.stubGlobal("crypto", { randomUUID: () => `operation-${++index}` });
  return new PetCareOperation();
}
describe("care task creation retries", () => {
  it("retries identical prepared input with one operation identity", () => {
    const request = operation(); const first = request.idFor(input);
    expect(request.idFor(input)).toBe(first); expect(request.idFor({ ...input, title: "  غذا دادن  " })).toBe(first);
  });
  it("starts a new operation when any submitted care field changes", () => {
    const request = operation(); const first = request.idFor(input);
    const title = request.idFor({ ...input, title: "آب دادن" }); const assignee = request.idFor({ ...input, assigneeId: "other" });
    const due = request.idFor({ ...input, dueDate: null }); expect(new Set([first, title, assignee, due]).size).toBe(4);
  });
  it("uses a new identity when the user opens another care form with identical values", () => {
    const request = operation(); const first = request.idFor(input); request.reset(); expect(request.idFor(input)).not.toBe(first);
  });
});
