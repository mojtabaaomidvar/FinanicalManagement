import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* Unlike a synchronous history stub, this preserves the gap between back()
   and popstate where React can close one dialog and open its replacement. */
function browserHistory() {
  const browser = new EventTarget();
  const entries: unknown[] = ["previous document", "application"];
  let position = 1;
  let pending = 0;
  let maxPending = 0;
  const history = {
    pushState: vi.fn((state: unknown) => {
      entries.splice(position + 1);
      entries.push(state);
      position++;
    }),
    back: vi.fn(() => {
      pending++;
      maxPending = Math.max(maxPending, pending);
    }),
  };
  vi.stubGlobal("window", browser);
  vi.stubGlobal("history", history);

  function finishBack() {
    expect(pending).toBeGreaterThan(0);
    pending--;
    position = Math.max(0, position - 1);
    browser.dispatchEvent(new Event("popstate"));
    expect(entries[position]).not.toBe("previous document");
  }
  return {
    history,
    finishBack,
    flushBacks() {
      for (let i = 0; pending && i < 20; i++) finishBack();
      expect(pending).toBe(0);
    },
    userBack() {
      history.back();
      finishBack();
    },
    get pending() { return pending; },
    get maxPending() { return maxPending; },
    get currentEntry() { return entries[position]; },
    get guardCount() { return position - 1; },
  };
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("backGuard asynchronous browser history", () => {
  it("restores nested guards in opening order despite child-first React effects", async () => {
    const browser = browserHistory();
    const { nextGuardOrder, pushOrderedGuard, popGuard } = await import("./backGuard");
    const parentOrder = nextGuardOrder(), childOrder = nextGuardOrder();
    const closeParent = vi.fn(), closeChild = vi.fn();
    const child = pushOrderedGuard(closeChild, childOrder);
    const parent = pushOrderedGuard(closeParent, parentOrder);
    expect(browser.history.pushState).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(browser.guardCount).toBe(2);
    popGuard(parent); popGuard(child); browser.flushBacks();
    expect(closeParent).not.toHaveBeenCalled(); expect(closeChild).not.toHaveBeenCalled();

    pushOrderedGuard(closeChild, childOrder); pushOrderedGuard(closeParent, parentOrder);
    await Promise.resolve();
    browser.userBack();
    expect(closeChild).toHaveBeenCalledOnce(); expect(closeParent).not.toHaveBeenCalled();
    browser.userBack(); expect(closeParent).toHaveBeenCalledOnce();
    expect(browser.currentEntry).toBe("application");
  });

  it("does not add history for a batched guard deactivated before registration settles", async () => {
    const browser = browserHistory();
    const { nextGuardOrder, pushOrderedGuard, popGuard } = await import("./backGuard");
    const id = pushOrderedGuard(vi.fn(), nextGuardOrder()); popGuard(id);
    await Promise.resolve();
    expect(browser.history.pushState).not.toHaveBeenCalled();
    expect(browser.history.back).not.toHaveBeenCalled();
  });

  it("keeps a replacement dialog above the application until it closes", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const closeDetail = vi.fn();
    const closeCare = vi.fn();
    const detail = pushGuard(closeDetail);

    popGuard(detail);
    const care = pushGuard(closeCare);
    expect(browser.history.pushState).toHaveBeenCalledTimes(1);
    expect(browser.pending).toBe(1);

    browser.finishBack();
    expect(browser.guardCount).toBe(1);
    expect(browser.history.pushState).toHaveBeenCalledTimes(2);
    expect(closeDetail).not.toHaveBeenCalled();
    expect(closeCare).not.toHaveBeenCalled();

    popGuard(care);
    browser.flushBacks();
    expect(browser.currentEntry).toBe("application");
    expect(browser.history.back).toHaveBeenCalledTimes(2);
  });

  it("cancels a replacement closed before its history entry was added", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const detail = pushGuard(vi.fn());
    popGuard(detail);
    const care = pushGuard(vi.fn());
    popGuard(care);
    popGuard(care);

    browser.flushBacks();
    expect(browser.history.pushState).toHaveBeenCalledTimes(1);
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(browser.currentEntry).toBe("application");
  });

  it("serializes several closes before adding a still-open replacement", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const closes = [vi.fn(), vi.fn(), vi.fn()];
    const guards = closes.map(pushGuard);
    popGuard(guards[2]);
    popGuard(guards[0]);
    popGuard(guards[1]);
    const replacement = pushGuard(vi.fn());

    expect(browser.history.back).toHaveBeenCalledTimes(1);
    browser.finishBack();
    expect(browser.history.pushState).toHaveBeenCalledTimes(3);
    browser.flushBacks();
    expect(browser.maxPending).toBe(1);
    expect(browser.history.back).toHaveBeenCalledTimes(3);
    expect(browser.guardCount).toBe(1);
    for (const close of closes) expect(close).not.toHaveBeenCalled();

    popGuard(replacement);
    browser.flushBacks();
    expect(browser.currentEntry).toBe("application");
  });

  it("closes only the top guard on user Back without another cleanup Back", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const closeFirst = vi.fn(() => popGuard(first));
    const first = pushGuard(closeFirst);
    const closeSecond = vi.fn(() => popGuard(second));
    const second = pushGuard(closeSecond);

    browser.userBack();
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
    expect(browser.history.back).toHaveBeenCalledTimes(1);
    expect(browser.pending).toBe(0);
    expect(browser.guardCount).toBe(1);

    browser.userBack();
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(browser.history.back).toHaveBeenCalledTimes(2);
    expect(browser.pending).toBe(0);
    expect(browser.currentEntry).toBe("application");
  });

  it("preserves upper guards when a lower layer closes, then removes its stale entry", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const closeFirst = vi.fn();
    const first = pushGuard(closeFirst);
    const closeSecond = vi.fn();
    pushGuard(closeSecond);
    popGuard(first);
    const closeReplacement = vi.fn();
    pushGuard(closeReplacement);

    expect(browser.history.back).not.toHaveBeenCalled();
    browser.userBack();
    expect(closeReplacement).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
    expect(browser.pending).toBe(0);

    browser.userBack();
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
    expect(browser.pending).toBe(1);
    browser.flushBacks();
    expect(browser.currentEntry).toBe("application");
  });

  it("handles a Back callback closing a lower layer and opening a replacement", async () => {
    const browser = browserHistory();
    const { pushGuard, popGuard } = await import("./backGuard");
    const first = pushGuard(vi.fn());
    let replacement: symbol | undefined;
    const closeReplacement = vi.fn();
    const closeSecond = vi.fn(() => {
      popGuard(second);
      popGuard(first);
      replacement = pushGuard(closeReplacement);
    });
    const second = pushGuard(closeSecond);

    browser.userBack();
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(browser.history.pushState).toHaveBeenCalledTimes(2);
    browser.flushBacks();
    expect(browser.guardCount).toBe(1);
    expect(closeReplacement).not.toHaveBeenCalled();

    popGuard(replacement!);
    browser.flushBacks();
    expect(browser.currentEntry).toBe("application");
    expect(browser.history.back).toHaveBeenCalledTimes(3);
  });
});
