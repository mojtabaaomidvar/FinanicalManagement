import { describe, expect, it, vi } from "vitest";
import { AssistantCapabilitiesUseCase, AnalyzeHouseholdUseCase, AssistantDraftUseCase, AssistantSaveStateUseCase } from "./assistant.usecases";
import { assistantDraftKey, assistantScopeForPage } from "@/features/household-assistant/model/assistant";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";

describe("household preparation boundaries", () => {
  it("capability detection cannot trigger analysis or business writes", async () => {
    const repo = { capabilities: vi.fn().mockResolvedValue({ status:"ready" }), analyze: vi.fn() };
    await new AssistantCapabilitiesUseCase(repo).execute();
    expect(repo.analyze).not.toHaveBeenCalled();
    await new AnalyzeHouseholdUseCase(repo).execute("user text", "shopping");
    expect(repo.analyze).toHaveBeenCalledExactlyOnceWith("user text", "shopping");
  });
  it("drafts are per family and member and serialized, including clear", async () => {
    const storage: SecureStorage = { persistent:true, get:vi.fn(), set:vi.fn(), remove:vi.fn() };
    const drafts = new AssistantDraftUseCase(storage), key = assistantDraftKey("family", "member");
    await Promise.all([drafts.write(key,{text:"first",scope:"auto"}), drafts.write(key,{text:"second",scope:"tasks"}), drafts.write(key,{text:"",scope:"auto"})]);
    expect(storage.set).toHaveBeenNthCalledWith(1,key,{text:"first",scope:"auto"});
    expect(storage.set).toHaveBeenNthCalledWith(2,key,{text:"second",scope:"tasks"});
    expect(storage.remove).toHaveBeenCalledWith(key);
    expect(assistantDraftKey("other", "member")).not.toBe(key);
    expect(assistantDraftKey("family", "other")).not.toBe(key);
  });
  it("memory-only storage is honestly rejected for durable drafts", async () => {
    const storage: SecureStorage = { persistent:false, get:vi.fn(), set:vi.fn(), remove:vi.fn() };
    await expect(new AssistantDraftUseCase(storage).write("key",{text:"private",scope:"auto"})).rejects.toThrow();
    expect(storage.set).not.toHaveBeenCalled();
  });
  it("specific accepted entity, not unrelated pending count, determines status", async () => {
    const readState = vi.fn().mockResolvedValue({pending:[{operation:{entity_id:"unrelated"}}],snapshot:{tasks:[{id:"task"}],lists:[]}});
    const outcome = new AssistantSaveStateUseCase({readState} as unknown as ShoppingOfflineEngine);
    expect(await outcome.execute("task","task")).toBe("saved");
    expect(await outcome.execute("item","unrelated")).toBe("queued");
    expect(await outcome.execute("task","missing")).toBe("queued");
  });
  it.each([["hub","auto"],["vehicles","auto"],["shopping","shopping"],["tasks","tasks"],["dashboard","finance"]])("visible page scope %s", (route,scope) => {
    expect(assistantScopeForPage(route)).toBe(scope);
  });
});
