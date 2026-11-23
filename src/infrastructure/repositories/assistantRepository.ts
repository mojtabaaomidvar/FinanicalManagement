import type { AssistantCapabilities, AssistantRepository, AssistantResult, AssistantScope } from "@/domain/assistant/assistant.types";
import type { RestClient } from "@/infrastructure/api/restClient";
import type { ActionReceipt, ContextRepository, ContextResult, PreparedAction, PrepareActionFields } from "@/domain/assistant/contextual.types";

export class RestAssistantRepository implements AssistantRepository, ContextRepository {
  constructor(private readonly client: RestClient) {}
  capabilities() {
    return this.client.get<AssistantCapabilities>("/assistant/capabilities", { cache: "no-store", timeoutMs: 10000 });
  }
  analyze(text: string, scope: AssistantScope) {
    return this.client.post<AssistantResult>("/assistant/analyze", { text, scope }, { cache: "no-store", timeoutMs: 35000 });
  }
  report(text: string) {
    return this.client.post<ContextResult>("/assistant/report", { text }, { cache: "no-store", timeoutMs: 70000 });
  }
  prepare(reportToken: string, actionId: string, fields: PrepareActionFields) {
    return this.client.post<PreparedAction>("/assistant/prepare-action", { report_token: reportToken, action_id: actionId, ...fields }, { cache: "no-store", timeoutMs: 15000 });
  }
  execute(reviewToken: string) {
    return this.client.post<ActionReceipt>("/assistant/execute", { review_token: reviewToken, confirmed: true }, { cache: "no-store", timeoutMs: 20000 });
  }
  receipt(operationId: string) {
    return this.client.get<ActionReceipt>(`/assistant/receipt/${encodeURIComponent(operationId)}`, { cache: "no-store", timeoutMs: 10000 });
  }
}
