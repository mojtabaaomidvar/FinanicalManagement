import type { AssistantRepository, AssistantScope } from "@/domain/assistant/assistant.types";
import type { SecureStorage } from "@/infrastructure/storage/secureStorage.adapter";
import type { ShoppingOfflineEngine } from "@/infrastructure/offline/shoppingOffline";
import type { ContextRepository, ContextSession, PrepareActionFields } from "@/domain/assistant/contextual.types";

export class AssistantCapabilitiesUseCase {
  constructor(private readonly repo: AssistantRepository) {}
  execute() { return this.repo.capabilities(); }
}
export class AnalyzeHouseholdUseCase {
  constructor(private readonly repo: AssistantRepository) {}
  execute(text: string, scope: AssistantScope) { return this.repo.analyze(text, scope); }
}
export class ContextualHouseholdUseCase {
  constructor(private readonly repo: ContextRepository) {}
  report(text: string) { return this.repo.report(text); }
  prepare(token: string, actionId: string, fields: PrepareActionFields) { return this.repo.prepare(token, actionId, fields); }
  execute(token: string) { return this.repo.execute(token); }
  receipt(operationId: string) { return this.repo.receipt(operationId); }
}
export interface AssistantDraft { text: string; scope: AssistantScope; session?: ContextSession }
export class AssistantDraftUseCase {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly storage: SecureStorage) {}
  read(key: string) { return this.storage.get<AssistantDraft>(key); }
  write(key: string, draft: AssistantDraft) {
    const result = this.writes.catch(() => undefined).then(async () => {
      if (this.storage.persistent === false) throw new Error("draft_not_persistent");
      if (draft.text || draft.session?.pending) await this.storage.set(key, draft);
      else await this.storage.remove(key);
    });
    this.writes = result;
    return result;
  }
}

export class AssistantSaveStateUseCase {
  constructor(private readonly engine: ShoppingOfflineEngine) {}
  async execute(kind: "task" | "item", entityId: string): Promise<"saved" | "queued"> {
    const state = await this.engine.readState();
    if (state.pending.some(row => row.operation.entity_id === entityId)) return "queued";
    const exists = kind === "task" ? state.snapshot.tasks?.some(row => row.id === entityId)
      : state.snapshot.lists.some(list => list.items.some(row => row.id === entityId));
    return exists ? "saved" : "queued";
  }
}
