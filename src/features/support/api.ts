import { supportRequest } from "@/infrastructure/api/restClient";

export type SupportPage = "overview" | "users" | "technical" | "usage" | "catalog";
export interface CatalogProposal {
  id: string; title: string; category: string; unit: string | null;
  status: "pending" | "approved" | "rejected"; submitted_at: string; reviewed_at: string | null;
  published_at?: string | null;
}
export interface CatalogProposals { items: CatalogProposal[]; total: number; offset: number; limit: number }
export type RegistrationState = "registered" | "introduced" | "managed";
export type MembershipState = "pending" | "active" | "rejected" | "expired" | "suspended" | "removed";
export interface SupportUser {
  support_code: string;
  created_at: string;
  registration_state: RegistrationState;
  membership_state: MembershipState;
  registered_at: string | null;
  last_login_at: string | null;
  stage: "registration_required" | "managed_profile" | "approval_pending" | "ready" | "inactive";
  attention_reason: "registration_incomplete" | "managed_profile" | "waiting_approval" | "rejected" | "expired" | "suspended" | "removed" | null;
}
export interface SupportUsers { items: SupportUser[]; total: number; offset: number; limit: number }
export interface SupportOverview {
  registered: number; introduced: number; managed: number;
  awaiting_approval: number; active: number; new_registrations: number;
  daily: Array<{ day: string; registrations: number }>; checked_at: string;
}
export interface SupportTechnical {
  api: "available"; database: "available"; sms: "configured" | "disabled";
  login_errors: number; registration_errors: number; server_errors: number;
  measured_hours: number; checked_at: string;
}
export interface SupportUsage {
  days: number;
  modules: Array<{ module: string; opens: number; creates: number; updates: number; completes: number; deletes: number }>;
  daily: Array<{ day: string; opens: number; operations: number }>;
  records: { transactions: number; scheduled_plans: number; open_tasks: number; completed_tasks: number; shopping_lists: number; documents: number };
  measured_since: string | null;
  checked_at: string;
}
export const supportApi = {
  session: () => supportRequest<{ authenticated: boolean }>("/session"),
  login: (username: string, password: string) => supportRequest<{ authenticated: boolean }>("/login", { username, password }),
  logout: () => supportRequest<void>("/logout", {}),
  overview: (days: number) => supportRequest<SupportOverview>(`/overview?days=${days}`),
  users: (query: { code: string; membership: string; registration: string; offset: number }) =>
    supportRequest<SupportUsers>("/users?" + new URLSearchParams({ ...query, offset: String(query.offset), limit: "25" })),
  technical: () => supportRequest<SupportTechnical>("/technical"),
  usage: (days: number) => supportRequest<SupportUsage>(`/usage?days=${days}`),
  catalog: (status: string, offset: number) => supportRequest<CatalogProposals>(
    "/catalog?" + new URLSearchParams({ status, offset: String(offset), limit: "25" })),
  reviewCatalog: (id: string, status: "approved" | "rejected", changes?: { title: string; category: string; unit: string | null }) =>
    supportRequest<CatalogProposal>("/catalog/review", { id, status, ...changes }),
};
