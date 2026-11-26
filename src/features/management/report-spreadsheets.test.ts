import { describe, expect, it } from "vitest";
import type { AnalyticsModule, ProductReport } from "./analytics.types";
import type { AiReport } from "./ai-analytics.types";
import type { Account, Audit, Backup, Job, Overview, Release, Service, User } from "./api";
import { loadReportSheets } from "./report-spreadsheets";

const days = 7 as const;
const inventory = Object.fromEntries(["wallets", "budget_limits", "bills", "inventory_items", "shopping_items",
  "meal_dishes", "meal_entries", "equipment", "vehicles", "maintenance_records", "calendar_events", "goals",
  "pets", "bank_messages"].map(key => [key, null])) as ProductReport["record_inventory"];
const product: ProductReport = {
  days, start_at: "2026-11-20T00:00:00+03:30", checked_at: "2026-11-26T08:00:00+03:30",
  snapshot: { families: 0, families_with_accounts: 0, profiles: 0, registered_accounts: 0,
    introduced_profiles: 0, managed_profiles: 0, active_accounts: 0, pending_accounts: 0,
    inactive_accounts: 0, accounts_with_login: 0, families_with_login: 0,
    accounts_without_login_history: 0, accounts_without_registration_history: 0 },
  daily: [{ day: "2026-11-20", families_created: 0, registrations_completed: 0, opens: null, requests: null, errors: null }],
  modules: null, usage: null, lifetime_usage: null, errors: null, records: null, record_inventory: inventory,
  measurement: { usage_available: false, errors_available: false, records_available: false,
    first_usage_counter: null, first_error_counter: null, website: "not_measured", unique_active_users: "not_measured",
    retention: "not_measured", session_duration: "not_measured", assistant_usage: "not_measured" },
};
const ai: AiReport = { days, start_at: product.start_at, checked_at: product.checked_at, available: false,
  first_counter: null, totals: null, stages: null };

function readerWithPages(calls: string[]) {
  const users: User[] = Array.from({ length: 53 }, (_, index) => ({ id: `user-${index}`, role: "member", state: "active",
    phone: "", created_at: "", last_login: null }));
  const backups: Backup[] = Array.from({ length: 203 }, (_, index) => ({ id: `backup-${index}`, created_at: index, bytes: index, image: "" }));
  const jobs: Job[] = Array.from({ length: 205 }, (_, index) => ({ id: `job-${index}`, actor: "owner",
    operation: { kind: "backup.create" }, status: "succeeded", created: index, finished: index, result: null }));
  const audits: Audit[] = Array.from({ length: 207 }, (_, index) => ({ id: index, actor: "owner", event: "session.login", detail: "{}", created: index }));
  const services: Service[] = ["api", "db", "nginx"].map(id => ({ id: id as Service["id"], state: "available", health: "", image: "" }));
  const accounts: Account[] = [{ id: "account", username: "owner", role: "owner", enabled: 1, created: 0, mfa: 1 }];
  const release: Release[] = [{ tag: "v1.0.0", sha256: "hash", fetched_at: 1 }];
  const paged = <T,>(path: string, all: T[], size: number, extra: object = {}) => {
    const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset") ?? 0);
    return { items: all.slice(offset, offset + size), total: all.length, offset, ...extra };
  };
  return async <T,>(path: string): Promise<T> => {
    calls.push(path);
    if (path.startsWith("/state/analytics?")) return product as T;
    if (path.startsWith("/state/ai-analytics?")) return ai as T;
    if (path === "/state/overview") return { api: "available", database: "available", version: "1", api_version: "1",
      software_version: "1", management_version: "1", cpu_load: 0, cpu_cores: 1, memory_total: 0, memory_used: 0,
      disk_total: 0, disk_used: 0, uptime_seconds: 1, checked_at: 1, services } satisfies Overview as T;
    if (path === "/state/services") return { items: services } as T;
    if (path.startsWith("/state/users?")) return paged(path, users, 25) as T;
    if (path.startsWith("/state/backups?")) return paged(path, backups, 100, { scheduled: false }) as T;
    if (path === "/state/releases") return { items: release } as T;
    if (path.startsWith("/jobs?")) return paged(path, jobs, 100) as T;
    if (path.startsWith("/audit?")) return paged(path, audits, 100) as T;
    if (path === "/accounts") return { items: accounts } as T;
    if (path.startsWith("/state/logs?")) return { text: "" } as T;
    throw new Error(`Unexpected report request: ${path}`);
  };
}

describe("Excel report bundles", () => {
  it("exports every row across pages, preserves unknown-versus-zero values, and scopes by role", async () => {
    const calls: string[] = [];
    const report = await loadReportSheets("all", "owner", days, readerWithPages(calls));
    expect(report.partial).toBe(false);
    expect(report.sheets.map(sheet => sheet.name)).toContain("همهٔ مسیرهای AI");
    expect(report.sheets.find(sheet => sheet.name === "پشتیبان‌ها")?.rows).toHaveLength(203);
    expect(report.sheets.find(sheet => sheet.name === "عملیات")?.rows).toHaveLength(205);
    expect(report.sheets.find(sheet => sheet.name === "سابقهٔ دسترسی")?.rows).toHaveLength(207);
    expect(report.sheets.find(sheet => sheet.name === "کاربران")?.rows).toHaveLength(53);
    expect(calls).toContain("/audit?offset=200");
    expect(calls).toContain("/jobs?offset=200");
    expect(calls).toContain("/state/backups?offset=200");
    expect(calls).toContain("/state/users?offset=50");

    const daily = report.sheets.find(sheet => sheet.name === "روند روزانه")!;
    expect(daily.rows[0][3]).toBe("اندازه‌گیری‌نشده");
    const snapshot = report.sheets.find(sheet => sheet.name === "خانواده و حساب")!;
    expect(snapshot.rows.find(row => row[1] === "families")?.slice(2)).toEqual([0, "صفر ثبت‌شده"]);

    const viewerCalls: string[] = [];
    const viewer = await loadReportSheets("all", "viewer", days, readerWithPages(viewerCalls));
    expect(viewer.sheets.map(sheet => sheet.name)).not.toContain("سابقهٔ دسترسی");
    expect(viewer.sheets.map(sheet => sheet.name)).not.toContain("مدیران");
    expect(viewerCalls.some(path => path.startsWith("/audit"))).toBe(false);
    expect(viewerCalls.some(path => path === "/accounts")).toBe(false);
  });

  it("marks a report incomplete rather than silently exporting a shifting page list", async () => {
    const calls: string[] = [];
    const reader = readerWithPages(calls);
    const unstable = async <T,>(path: string): Promise<T> => {
      if (path === "/state/users?offset=25") return { items: [], total: 54, offset: 25 } as T;
      return reader<T>(path);
    };
    const result = await loadReportSheets("users", "owner", days, unstable);
    expect(result.partial).toBe(true);
    expect(result.sheets.some(sheet => sheet.name.startsWith("کاربران") && sheet.rows[0][2] === "دریافت ناموفق")).toBe(true);
  });

  it("keeps unknown module counts distinct from measured empty modules", async () => {
    const moduleRows: ProductReport = { ...product, modules: [{ module: "shopping" as AnalyticsModule,
      opens: 0, creates: 0, updates: 0, completes: 0, deletes: 0 }] };
    const rows = await loadReportSheets("analytics", "viewer", days, async <T,>(path: string): Promise<T> => {
      if (path.startsWith("/state/analytics?")) return moduleRows as T;
      if (path.startsWith("/state/ai-analytics?")) return ai as T;
      throw new Error(path);
    });
    const modules = rows.sheets.find(sheet => sheet.name === "همهٔ بخش‌ها")!;
    const shopping = modules.rows.find(row => row[1] === "shopping")!;
    const tasks = modules.rows.find(row => row[1] === "tasks")!;
    expect(shopping.at(-1)).toBe("صفر ثبت‌شده");
    expect(tasks.at(-1)).toBe("اندازه‌گیری‌نشده");
  });
});
