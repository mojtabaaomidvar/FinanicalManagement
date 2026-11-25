import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "./restClient";

afterEach(() => vi.unstubAllGlobals());

describe("exact-money wire contract", () => {
  it("sends the capability on financial reads and preserves exact request strings", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response('{}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RestClient({ getToken: async () => "session-token" });
    await client.get("/accounts");
    await client.post("/transactions", { amount: "90071992547.41" }, { bearer: "pinned-token" });
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["X-Khaneyar-Money-Contract"]).toBe("decimal-v1");
    }
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer pinned-token");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).amount).toBe("90071992547.41");
  });

  it("keeps the old-compatible server update message without retrying the write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "CLIENT_UPDATE_REQUIRED", message: "ابتدا برنامه را به‌روزرسانی کنید.",
    }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new RestClient({ getToken: async () => "token" });
    await expect(client.post("/accounts/id/corrections", { target_balance: "0.01" })).rejects.toMatchObject({
      serverCode: "CLIENT_UPDATE_REQUIRED", status: 409, message: "ابتدا برنامه را به‌روزرسانی کنید.",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("authenticated document transport", () => {
  const client = () => new RestClient({ getToken: async () => "session-token" });

  it("sends private multipart bytes with bearer authorization and no HTTP cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"document"}', {
      status: 201, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const form = new FormData();
    form.append("file", new Blob(["private-file"], { type: "application/pdf" }), "record.pdf");
    await client().postForm("/documents", form);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).not.toContain("session-token");
    expect(init.headers.Authorization).toBe("Bearer session-token");
    expect(init.headers["X-Khaneyar-Money-Contract"]).toBe("decimal-v1");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBe(form);
    expect(init.cache).toBe("no-store");
  });

  it("downloads protected bytes through the same authenticated uncached transport", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("private-content", {
      headers: { "Content-Type": "application/pdf" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const blob = await client().getBlob("/documents/id/file");
    expect(await blob.text()).toBe("private-content");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer session-token");
    expect(fetchMock.mock.calls[0][1].headers["X-Khaneyar-Money-Contract"]).toBe("decimal-v1");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("reports denied file access as an error instead of returning an error page as a file", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "DOCUMENT_FORBIDDEN", message: "اجازهٔ دریافت ندارید.",
    }), { status: 403 })));
    await expect(client().getBlob("/documents/id/file")).rejects.toMatchObject({
      code: "FORBIDDEN", status: 403, serverCode: "DOCUMENT_FORBIDDEN",
    });
  });
});
