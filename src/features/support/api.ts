import { supportRequest } from "@/infrastructure/api/restClient";

export type SupportPage = "overview" | "users" | "technical";
export type RegistrationState = "registered" | "introduced" | "managed";
export type MembershipState = "pending" | "active" | "rejected" | "expired" | "suspended" | "removed";
export interface SupportUser {
  support_code: string;
  created_at: string;
  registration_state: RegistrationState;
  membership_state: MembershipState;
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
export const supportApi = {
  session: () => supportRequest<{ authenticated: boolean }>("/session"),
  login: (username: string, password: string) => supportRequest<{ authenticated: boolean }>("/login", { username, password }),
  logout: () => supportRequest<void>("/logout", {}),
  overview: (days: number) => supportRequest<SupportOverview>(`/overview?days=${days}`),
  users: (query: { code: string; membership: string; registration: string; offset: number }) =>
    supportRequest<SupportUsers>("/users?" + new URLSearchParams({ ...query, offset: String(query.offset), limit: "25" })),
  technical: () => supportRequest<SupportTechnical>("/technical"),
};
