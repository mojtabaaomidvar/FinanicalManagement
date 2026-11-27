import { describe, expect, it, vi } from "vitest";
import { coalesceHouseholdChanges, readHouseholdChanges } from "./householdChanges";

describe("household event reader", () => {
  it("accepts chunked CRLF invalidations but ignores comments, payloads and other events", async () => {
    const changed = vi.fn(), encoder = new TextEncoder();
    const parts = ["event: rea", "dy\r", "\ndata: {}\r\n\r\n: keepalive\n\n", "event: private\ndata: secret\n\nevent: invalidate\ndata: {}\n\n"];
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
    await readHouseholdChanges(stream, changed, new AbortController().signal);
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("cancels the reader on logout without delivering another event", async () => {
    const aborted = new AbortController(), cancel = vi.fn(), changed = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const running = readHouseholdChanges(stream, changed, aborted.signal);
    aborted.abort(); await running;
    expect(cancel).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled();
  });
});

describe("household refresh coalescing", () => {
  it("merges bursts and follows an in-flight refresh with the latest change", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const watcher = coalesceHouseholdChanges(refresh, 10);
    try {
      watcher.changed(); watcher.changed(); watcher.changed();
      await vi.advanceTimersByTimeAsync(10);
      expect(refresh).toHaveBeenCalledTimes(1);
      watcher.changed(); watcher.changed();
      finish(); await vi.advanceTimersByTimeAsync(10);
      expect(refresh).toHaveBeenCalledTimes(2);
      watcher.changed(); watcher.stop(); await vi.runAllTimersAsync();
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally { watcher.stop(); vi.useRealTimers(); }
  });
});
