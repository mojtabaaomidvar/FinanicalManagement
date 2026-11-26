export type Role = "owner" | "operator" | "viewer";
export type Session = { authenticated: boolean; mode: "production" | "demo"; username: string; role: Role; csrf: string; mfa: boolean; expires_at: number | null };
export type OperationKind = "service.start" | "service.stop" | "service.restart" | "nginx.reload" | "certificate.renew"
  | "host.reboot" | "host.cancel_reboot" | "backup.create" | "backup.verify" | "backup.restore" | "backup.schedule"
  | "release.fetch" | "release.install" | "settings.update" | "user.suspend" | "user.activate" | "user.revoke_sessions";
export type Operation = { kind: OperationKind; target?: string; values?: Record<string, string | boolean>; expected?: string };
export type Plan = { id: string; operation: Operation; expires_at: number; demo: boolean };
export type Credential = { password: string; code: string };
export type Service = { id: "api" | "db" | "nginx"; state: string; health: string; image: string };
export type Overview = { api: string; database: string; version: string; software_version?: string; api_version?: string; management_version?: string; cpu_load: number; cpu_cores: number;
  memory_total: number; memory_used: number; disk_total: number; disk_used: number; uptime_seconds: number; services: Service[]; checked_at: number };
export type User = { id: string; role: string; state: string; phone: string; created_at: string; last_login: string | null };
export type Settings = { flags: Record<string, boolean>; environment: Record<string, string | boolean>;
  features?: Record<string, string>; feature_controls_supported?: boolean; ai_controls_supported?: boolean;
  ai_configuration_applied?: boolean; runtime_applied?: boolean; revision: string; runtime_supported: boolean };
export type Backup = { id: string; created_at: number; bytes: number; image: string };
export type Release = { tag: string; sha256: string; fetched_at: number };
export type Job = { id: string; actor: string; operation: Operation; status: "queued" | "running" | "succeeded" | "failed" | "interrupted"; created: number; finished: number | null;
  result: { message?: string; safety_backup?: string; backup_id?: string; error?: string } | null };
export type Account = { id: string; username: string; role: Role; enabled: number; created: number; mfa: number };
export type Audit = { id: number; actor: string; event: string; detail: string; created: number };

export class ManagementApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

let csrf = "";
const prefix = "/management/api";

async function response(path: string, method: string, body?: unknown, signal?: AbortSignal): Promise<Response> {
  const result = await fetch(prefix + path, {
    method, credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { "Content-Type": "application/json", ...(csrf ? { "X-Management-CSRF": csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!result.ok) {
    let message = "ارتباط با سرویس مدیریت موفق نبود؛ دوباره تلاش کنید.";
    try { const error: { message?: string } = await result.json(); if (typeof error.message === "string") message = error.message; } catch { /* Use the editable display fallback. */ }
    if (result.status === 401 && path !== "/login") window.dispatchEvent(new Event("management:unauthorized"));
    throw new ManagementApiError(message, result.status);
  }
  return result;
}

export const managementApi = {
  setSession(session: Session | null) { csrf = session?.csrf ?? ""; },
  async get<T>(path: string, signal?: AbortSignal): Promise<T> { return (await response(path, "GET", undefined, signal)).json() as Promise<T>; },
  async post<T>(path: string, body: unknown): Promise<T> { return (await response(path, "POST", body)).json() as Promise<T>; },
  async patch<T>(path: string, body: unknown): Promise<T> { return (await response(path, "PATCH", body)).json() as Promise<T>; },
  async download(backupId: string, credential: Credential) {
    const result = await response("/backup-download", "POST", { backup_id: backupId, ...credential });
    const blob = await result.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = /filename="([^"]+)"/.exec(result.headers.get("Content-Disposition") ?? "")?.[1];
    link.href = url; link.download = filename ?? `khaneyar-${backupId}.tar`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
};
