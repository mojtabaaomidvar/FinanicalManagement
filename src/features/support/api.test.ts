import { afterEach, describe, expect, it, vi } from "vitest";
import { supportApi } from "./api";
import { supportRequest } from "@/infrastructure/api/restClient";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("independent support API boundary", () => {
  it("uses the dedicated support origin without attaching a household token", async () => {
    vi.stubEnv("VITE_SUPPORT_HOST","supp.khaanehyar.ir");
    vi.stubGlobal("location",{hostname:"supp.khaanehyar.ir",protocol:"https:"});
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({authenticated:false}),{status:200})));
    vi.stubGlobal("fetch",fetcher);
    await supportApi.session(); await supportApi.usage(30);
    expect(fetcher.mock.calls[0][0]).toBe("/api/v1/support/session");
    expect(fetcher.mock.calls[1][0]).toBe("/api/v1/support/usage?days=30");
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty("Authorization");
  });
  it("uses only its cookie and no household bearer, with no browser response cache", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ authenticated: true }), { status: 200 })));
    vi.stubGlobal("fetch",fetcher);
    await supportApi.session();
    await supportApi.login("operator", "password-marker");
    expect(fetcher.mock.calls[0][0]).toMatch(/\/api\/v1\/support\/session$/);
    for (const [,init] of fetcher.mock.calls) {
      expect(init.credentials).toBe("include");
      expect(init.cache).toBe("no-store");
      expect(init.headers).not.toHaveProperty("Authorization");
    }
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ username:"operator",password:"password-marker" });
  });
  it("refuses household endpoints without a request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch",fetcher);
    await expect(supportRequest("/accounts")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("only sends proposal review metadata with the independent cookie", async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", fetcher);
    await supportApi.catalog("approved", 25);
    await supportApi.reviewCatalog("proposal-marker", "approved");
    const url = new URL(fetcher.mock.calls[0][0], "http://test.local");
    expect(url.pathname).toMatch(/\/support\/catalog$/);
    expect(url.searchParams.get("offset")).toBe("25");
    expect(fetcher.mock.calls[1][0]).toMatch(/\/support\/catalog\/review$/);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ id: "proposal-marker", status: "approved" });
    expect(fetcher.mock.calls[1][1].headers).not.toHaveProperty("Authorization");
    expect(fetcher.mock.calls[1][1].credentials).toBe("include");
    await expect(supportRequest("/catalog/delete")).rejects.toThrow();
  });
  it("encodes code filters and preserves the independent authorization error code", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error:"SUPPORT_UNAUTHORIZED",message:"expired" }),{status:401}));
    vi.stubGlobal("fetch",fetcher);
    await expect(supportApi.users({ code:"code & marker",membership:"pending",registration:"all",offset:25 }))
      .rejects.toMatchObject({ serverCode:"SUPPORT_UNAUTHORIZED",status:401 });
    const url = new URL(fetcher.mock.calls[0][0],"http://test.local");
    expect(url.searchParams.get("code")).toBe("code & marker");
    expect(url.searchParams.get("offset")).toBe("25");
  });
});
