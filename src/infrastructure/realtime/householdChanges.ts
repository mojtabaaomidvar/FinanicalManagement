import type { RestClient } from "@/infrastructure/api/restClient";

/** Consume only invalidation events; never interpret event data as application records. */
export async function readHouseholdChanges(body: ReadableStream<Uint8Array>, changed: () => void, signal: AbortSignal) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 8192) throw new Error("Invalid event frame");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (!signal.aborted && frame.split("\n").some(line => /^event:\s*(ready|invalidate)\s*$/.test(line))) changed();
      }
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Coalesce bursts without cancelling a running refresh or losing its final event. */
export function coalesceHouseholdChanges(refresh: () => Promise<void>, delay = 150) {
  let pending = false, running = false, stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    timer = undefined;
    if (running || stopped || !pending) return;
    pending = false; running = true;
    try { await refresh(); } catch { /* Reconnect/focus will reread; no sync notifications. */ }
    finally {
      running = false;
      if (pending && !stopped) timer = setTimeout(() => { void run(); }, delay);
    }
  };
  return {
    changed: () => { if (stopped) return; pending = true; if (!running && timer === undefined) timer = setTimeout(() => { void run(); }, delay); },
    stop: () => { stopped = true; pending = false; clearTimeout(timer); },
  };
}

export function watchHouseholdChanges(client: Pick<RestClient, "changes">, refresh: () => Promise<void>) {
  const updates = coalesceHouseholdChanges(refresh);
  let stopped = false, controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined, backoff = 1000;
  const connect = async () => {
    if (stopped || controller || navigator.onLine === false || document.visibilityState === "hidden") return;
    const active = new AbortController(); controller = active;
    // Also bounds proxies which keep a dead connection open without heartbeats.
    const watchdog = setTimeout(() => active.abort(), 65000);
    try {
      const response = await client.changes(active.signal);
      if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return;
      backoff = 1000;
      await readHouseholdChanges(response.body, updates.changed, active.signal);
      if (!active.signal.aborted) updates.changed();
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && [401, 403].includes(Number(error.status))) updates.changed();
      // Reconnect silently. The outbox is independent of this read channel.
    }
    finally {
      clearTimeout(watchdog);
      if (controller === active) controller = null;
      if (!stopped) { timer = setTimeout(() => { void connect(); }, backoff); backoff = Math.min(backoff * 2, 15000); }
    }
  };
  const wake = () => {
    clearTimeout(timer);
    if (document.visibilityState === "hidden" || navigator.onLine === false) { controller?.abort(); return; }
    updates.changed();
    void connect();
  };
  window.addEventListener("online", wake); window.addEventListener("offline", wake);
  window.addEventListener("focus", wake); document.addEventListener("visibilitychange", wake);
  void connect();
  return () => {
    stopped = true; controller?.abort(); clearTimeout(timer); updates.stop();
    window.removeEventListener("online", wake); window.removeEventListener("offline", wake);
    window.removeEventListener("focus", wake); document.removeEventListener("visibilitychange", wake);
  };
}
