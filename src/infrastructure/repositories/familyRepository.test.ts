import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { defaultHomePreferences } from "@/domain/home/homePreferences.rules";
import { SupabaseFamilyRepository } from "./familyRepository";

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
function setup() {
  vi.stubGlobal("navigator", { onLine: true });
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response({ revision: 0, preferences: null }));
  const getToken = vi.fn(async () => "token-a" as string | null);
  vi.stubGlobal("fetch", fetchMock);
  const provider = { getToken };
  return { repo: new SupabaseFamilyRepository(new RestClient(provider), provider), getToken, fetchMock };
}

describe("own home preferences transport", () => {
  it("blocks offline reads and writes before reading the session", async () => {
    const context = setup();
    vi.stubGlobal("navigator", { onLine: false });
    await expect(context.repo.getHomePreferences()).rejects.toMatchObject({ code: "NETWORK" });
    await expect(context.repo.setHomePreferences(0, defaultHomePreferences())).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled();
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("does not send unauthenticated preferences after logout", async () => {
    const context = setup();
    context.getToken.mockResolvedValue(null);
    await expect(context.repo.getHomePreferences()).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    await expect(context.repo.setHomePreferences(0, defaultHomePreferences())).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("captures the starting bearer once when an account changes while preparing a write", async () => {
    const context = setup();
    let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.setHomePreferences(0, defaultHomePreferences());
    context.getToken.mockResolvedValue("token-b");
    release("token-a");
    await saving;
    expect(context.fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect(context.getToken).toHaveBeenCalledOnce();
  });

  it("blocks a write if the device disconnects while preparing its bearer", async () => {
    const context = setup();
    let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.setHomePreferences(0, defaultHomePreferences());
    vi.stubGlobal("navigator", { onLine: false });
    release("token-a");
    await expect(saving).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("loads only the current member endpoint without HTTP caching or fabricated defaults", async () => {
    const context = setup();
    expect(await context.repo.getHomePreferences()).toEqual({ revision: 0, preferences: null });
    const [url, init] = context.fetchMock.mock.calls[0];
    expect(url).toContain("/members/me/home-preferences");
    expect(init).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: "Bearer token-a" } });
  });

  it("repairs old preference fields from a response while preserving its revision", async () => {
    const context = setup();
    context.fetchMock.mockImplementationOnce(async () => response({ revision: 4, preferences: { pins: ["goals"], openGroups: [] } }));
    expect(await context.repo.getHomePreferences()).toEqual({ revision: 4, preferences: { ...defaultHomePreferences(), pins: ["goals"], openGroups: [] } });
  });

  it("sends a complete revision-controlled personal arrangement and omits forged ownership fields", async () => {
    const context = setup();
    const preferences = { ...defaultHomePreferences(), pins: ["goals"], memberId: "forged-member", familyId: "forged-family" };
    context.fetchMock.mockImplementationOnce(async () => response({ revision: 6, preferences }));
    const result = await context.repo.setHomePreferences(5, preferences);
    const [url, init] = context.fetchMock.mock.calls[0];
    expect(url).toContain("/members/me/home-preferences");
    expect(init).toMatchObject({ method: "PATCH", cache: "no-store", headers: { Authorization: "Bearer token-a" } });
    expect(JSON.parse(init.body as string)).toEqual({ revision: 5, preferences: { ...defaultHomePreferences(), pins: ["goals"] } });
    expect(result).toEqual({ revision: 6, preferences: { ...defaultHomePreferences(), pins: ["goals"] } });
  });

  it("propagates a conflict without an automatic overwrite or retry", async () => {
    const context = setup();
    context.fetchMock.mockImplementationOnce(async () => response({ error: "HOME_PREFERENCES_CONFLICT", message: "چیدمان در نشست دیگری تغییر کرده است." }, 409));
    await expect(context.repo.setHomePreferences(2, defaultHomePreferences())).rejects.toMatchObject({ status: 409, serverCode: "HOME_PREFERENCES_CONFLICT" });
    expect(context.fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves a revoked session error instead of returning a previous arrangement", async () => {
    const context = setup();
    await context.repo.getHomePreferences();
    context.fetchMock.mockImplementationOnce(async () => response({ error: "SESSION_EXPIRED" }, 401));
    await expect(context.repo.getHomePreferences()).rejects.toMatchObject({ code: "SESSION_EXPIRED", status: 401 });
    expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });
});
