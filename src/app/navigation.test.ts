import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function browser(initial = "https://example.test/?invite=keep") {
  const window = new EventTarget();
  const entries: { state: unknown; url: string }[] = [{ state: null, url: initial }];
  let index = 0, pending = 0;
  const location = { href: initial };
  const history = {
    get state() { return entries[index].state; },
    scrollRestoration: "auto",
    pushState: vi.fn((state: unknown, _title: string, url = location.href) => {
      entries.splice(index + 1); entries.push({ state, url }); index++; location.href = url;
    }),
    replaceState: vi.fn((state: unknown, _title: string, url = location.href) => { entries[index] = { state, url }; location.href = url; }),
    back: vi.fn(() => { pending++; }),
  };
  vi.stubGlobal("window", window); vi.stubGlobal("history", history); vi.stubGlobal("location", location);
  async function travel(direction: number) {
    index = Math.max(0, Math.min(entries.length - 1, index + direction)); location.href = entries[index].url;
    const event = new Event("popstate"); Object.assign(event, { state: history.state }); window.dispatchEvent(event);
    await Promise.resolve();
  }
  return { history, location, get index() { return index; }, get pending() { return pending; },
    async finishBack() { expect(pending).toBeGreaterThan(0); pending--; await travel(-1); },
    forward: () => travel(1),
  };
}
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
describe("existing router backed by actual browser visits", () => {
  it("returns to the actual previous destination, with working Forward", async () => {
    const b = browser(), change = vi.fn();
    const { createNavigation } = await import("./navigation");
    const nav = createNavigation("self", change);
    nav.navigate("sections"); nav.navigate("vehicles"); nav.navigate("documents");
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "vehicles", depth: 2 });
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "sections", depth: 1 });
    await b.forward(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "vehicles", depth: 2 });
    nav.dispose();
  });
  it("does not duplicate same-route navigation and preserves invite parameters", async () => {
    const b = browser(); const { createNavigation } = await import("./navigation");
    const nav = createNavigation("self", vi.fn()); nav.navigate("hub"); nav.navigate("inventory"); nav.navigate("inventory");
    expect(b.history.pushState).toHaveBeenCalledTimes(1); expect(new URL(b.location.href).searchParams.get("invite")).toBe("keep"); nav.dispose();
  });
  it.each([['vehicles', 'sections'], ['transactions', 'dashboard'], ['calendar', 'sections']] as const)("seeds a logical parent for direct entry %s", async (route, parent) => {
    const b = browser(`https://example.test/#/${route}`), change = vi.fn();
    const { createNavigation } = await import("./navigation"); const nav = createNavigation("self", change);
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: parent, depth: 0 }); nav.dispose();
  });
  it("consumes the dialog first and never overwrites the underlying route", async () => {
    const b = browser(), change = vi.fn(); const { createNavigation } = await import("./navigation");
    const { pushGuard, popGuard } = await import("@/shared/lib/backGuard");
    const nav = createNavigation("self", change); nav.navigate("bills");
    const close = vi.fn(() => popGuard(id)), id = pushGuard(close);
    expect(b.history.state).toMatchObject({ khaneyarNavigation: { route: "bills" }, backGuard: true });
    nav.back(); await b.finishBack(); expect(close).toHaveBeenCalledOnce(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "bills", depth: 1 });
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "hub", depth: 0 }); nav.dispose();
  });
  it("serializes route navigation after closing a subpage without consuming the destination", async () => {
    const b = browser(), change = vi.fn(); const { createNavigation } = await import("./navigation");
    const { pushGuard } = await import("@/shared/lib/backGuard");
    const nav = createNavigation("self", change); nav.navigate("settings"); pushGuard(vi.fn());
    nav.navigate("children"); expect(b.pending).toBe(1); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "settings", depth: 1 });
    await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "children", depth: 2 });
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "settings", depth: 1 }); nav.dispose();
  });
  it("does not revive another identity on Back", async () => {
    const b = browser(), change = vi.fn(); const { createNavigation } = await import("./navigation");
    const previous = createNavigation("other", vi.fn()); previous.navigate("vehicles"); previous.dispose();
    const nav = createNavigation("self", change); nav.back(); await b.finishBack();
    expect(change.mock.calls.at(-1)?.[0].scope).toBe("self"); expect(change.mock.calls.at(-1)?.[0].route).not.toBe("vehicles"); nav.dispose();
  });
  it("places a newly opened destination dialog after the queued route, not before it", async () => {
    const b = browser(), change = vi.fn(); const { createNavigation } = await import("./navigation");
    const { pushGuard, popGuard } = await import("@/shared/lib/backGuard");
    const nav = createNavigation("self", change); nav.navigate("vehicles"); pushGuard(vi.fn());
    nav.navigate("transactions"); const close = vi.fn(() => popGuard(dialog)), dialog = pushGuard(close);
    await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "transactions", depth: 2 });
    expect(b.history.state).toMatchObject({ khaneyarNavigation: { route: "transactions" }, backGuard: true });
    nav.back(); await b.finishBack(); expect(close).toHaveBeenCalledOnce();
    nav.back(); await b.finishBack(); expect(change).toHaveBeenLastCalledWith({ scope: "self", route: "vehicles", depth: 1 }); nav.dispose();
  });
});
