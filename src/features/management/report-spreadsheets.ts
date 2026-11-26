import type { AnalyticsDays, AnalyticsModule, ProductReport } from "./analytics.types";
import type { AiReport, AiTotals } from "./ai-analytics.types";
import type { Account, Audit, Backup, Job, Overview, Release, Role, Service, User } from "./api";
import { managementApi as api, ManagementApiError } from "./api";
import { actionLabels, auditLabels, pageLabels, roleLabels, serviceLabels, stateLabels, type Page } from "./labels";
import { countLabels, excelLabels as L, moduleLabels, recordLabels, snapshotLabels, stageLabels } from "./report.labels";
import type { ExcelSheet, ExcelValue } from "./xlsx";

const value = (input: ExcelValue, missing = L.unknown): ExcelValue => input == null || input === "" ? missing : input;
const status = (input: ExcelValue): string => input == null ? L.unknown : input === 0 ? L.zero : L.measured;
const keyedSheet = (name: string, labels: Record<string, string>, data?: object | null): ExcelSheet => ({
  name, columns: [L.field, L.key, L.value, L.status],
  rows: Object.entries(labels).map(([key, label]) => {
    const entry = (data as Record<string, ExcelValue> | null | undefined)?.[key];
    return [label, key, value(entry), status(entry)];
  }),
});
const table = (name: string, columns: string[], rows: ExcelValue[][]): ExcelSheet => ({
  name, columns, rows: rows.length ? rows : [[L.empty, ...columns.slice(1).map(() => null)]],
});

export const productSheets = (report: ProductReport | undefined, days: AnalyticsDays): ExcelSheet[] => {
  const modules = new Map(report?.modules?.map(row => [row.module, row]));
  const fields = ["opens", "creates", "updates", "completes", "deletes"] as const;
  const rows = report?.daily ?? [];
  return [
    keyedSheet(L.snapshot, snapshotLabels, report?.snapshot),
    table(L.daily, [L.day, L.newFamilies, L.registrations, L.opens, L.requests, L.authErrors], rows.map(row => [
      row.day, row.families_created, row.registrations_completed, value(row.opens), value(row.requests), value(row.errors),
    ])),
    { name: L.modules, columns: [L.field, L.key, L.opens, L.creates, L.updates, L.completes, L.deletes, L.requests, L.status],
      rows: (Object.keys(moduleLabels) as AnalyticsModule[]).map(key => {
        const row = modules.get(key);
        return [moduleLabels[key], key, ...fields.map(field => value(row?.[field])),
          row ? row.creates + row.updates + row.completes + row.deletes : L.unknown,
          row ? (fields.every(field => row[field] === 0) ? L.zero : L.measured) : L.unknown];
      }) },
    keyedSheet(L.counts, { ...countLabels, ...recordLabels }, { ...report?.records, ...report?.record_inventory }),
    keyedSheet(L.usage, { opens: L.opens, requests: L.requests, lifetime_opens: L.lifetimeOpens, lifetime_requests: L.lifetimeRequests },
      { ...report?.usage, lifetime_opens: report?.lifetime_usage?.opens, lifetime_requests: report?.lifetime_usage?.requests }),
    keyedSheet(L.errors, { login: L.loginErrors, registration: L.registrationErrors, server: L.serverErrors, total: L.totalErrors }, report?.errors),
    keyedSheet(L.measurement, {
      days: L.days, start_at: L.start, checked_at: L.checked,
      usage_available: L.modules, errors_available: L.errors, records_available: L.counts,
      first_usage_counter: L.firstUsage, first_error_counter: L.firstError,
      website: L.website, unique_active_users: L.unique, retention: L.retention, session_duration: L.duration,
      assistant_usage: L.oldAssistant,
    }, { ...report?.measurement, days, start_at: report?.start_at, checked_at: report?.checked_at,
      website: L.unknown, unique_active_users: L.unknown, retention: L.unknown, session_duration: L.unknown,
      assistant_usage: L.unknown }),
  ];
};

const aiFields: Record<keyof AiTotals, string> = {
  requests: L.calls, successes: L.successes, failures: L.failures, input_tokens: L.input,
  output_tokens: L.output, input_token_requests: L.inputRequests, output_token_requests: L.outputRequests,
};
export const aiSheets = (report?: AiReport): ExcelSheet[] => {
  const stages = new Map(report?.stages?.map(row => [row.stage, row]));
  return [
    keyedSheet(L.aiTotals, aiFields, report?.totals),
    { name: L.aiStages, columns: [L.field, L.key, ...Object.values(aiFields), L.status],
      rows: (Object.keys(stageLabels) as (keyof typeof stageLabels)[]).map(stage => {
        const row = stages.get(stage);
        return [stageLabels[stage], stage, ...Object.keys(aiFields).map(key => value(row?.[key as keyof AiTotals], L.notReported)),
          row ? (row.requests === 0 ? L.zero : L.measured) : L.unknown];
      }) },
    keyedSheet(L.firstAi, { days: L.days, start_at: L.start, checked_at: L.checked, available: L.measured, first_counter: L.firstAi }, report),
  ];
};

export const overviewSheets = (report?: Overview): ExcelSheet[] => [
  keyedSheet(L.overview, {
    api: L.api, database: L.database, software_version: L.softwareVersion, api_version: L.apiVersion,
    management_version: L.managementVersion, cpu_load: L.cpu, cpu_cores: L.cores, memory_used: L.ramUsed,
    memory_total: L.ramTotal, disk_used: L.diskUsed, disk_total: L.diskTotal, uptime_seconds: L.uptime,
    checked_at: L.checked,
  }, report && { ...report, api: stateLabels[report.api] ?? L.unknown, database: stateLabels[report.database] ?? L.unknown,
    api_version: report.api_version || report.version, checked_at: new Date(report.checked_at * 1000).toISOString() }),
];

type Reader = <T>(path: string) => Promise<T>;
type Source = { name: string; load: () => Promise<ExcelSheet[]> };
export type ExportBundle = { sheets: ExcelSheet[]; partial: boolean };
type ResultPage<T> = { items: T[]; total: number; offset: number; scheduled?: boolean };

async function readAllPages<T extends object>(
  path: string, pageSize: number, read: Reader, active: () => boolean,
  identity: (row: T) => string | number,
): Promise<{ items: T[]; first: ResultPage<T> }> {
  const first = await read<ResultPage<T>>(`${path}?offset=0`);
  if (!Number.isSafeInteger(first.total) || first.total < 0 || first.offset !== 0 ||
      first.items.length > pageSize) throw new Error(L.exportIncomplete);
  const rows = new Map<string | number, T>();
  const append = (items: T[]) => {
    for (const row of items) {
      const key = identity(row);
      if (rows.has(key)) throw new Error(L.exportChanged);
      rows.set(key, row);
    }
  };
  append(first.items);
  for (let offset = pageSize; offset < first.total; offset += pageSize) {
    if (!active()) throw new Error(L.exportChanged);
    const page = await read<ResultPage<T>>(`${path}?offset=${offset}`);
    if (page.total !== first.total || page.offset !== offset || page.items.length === 0 ||
        page.items.length > pageSize || (offset + page.items.length < first.total && page.items.length < pageSize)) {
      throw new Error(L.exportChanged);
    }
    append(page.items);
  }
  if (rows.size !== first.total) throw new Error(L.exportChanged);
  return { items: [...rows.values()], first };
}

export const loadReportSheets = async (
  scope: Page | "all", role: Role, days: AnalyticsDays,
  read: Reader = api.get, active: () => boolean = () => true,
): Promise<ExportBundle> => {
  const sources: Source[] = [];
  const include = (...pages: (Page | "all")[]) => scope === "all" || pages.includes(scope);
  if (include("dashboard", "analytics")) {
    sources.push({ name: pageLabels.analytics, load: async () => productSheets(await read<ProductReport>(`/state/analytics?days=${days}`), days) });
    sources.push({ name: L.aiTotals, load: async () => aiSheets(await read<AiReport>(`/state/ai-analytics?days=${days}`)) });
  }
  if (include("dashboard", "overview")) sources.push({ name: L.overview, load: async () => overviewSheets(await read<Overview>("/state/overview")) });
  if (include("dashboard", "overview", "server")) sources.push({ name: L.services, load: async () => {
    const data = await read<{ items: Service[] }>("/state/services");
    return [table(L.services, [L.service, L.status, L.image], ["api", "db", "nginx"].map(key => {
      const row = data.items.find(item => item.id === key);
      return [serviceLabels[key], row ? stateLabels[row.state] ?? row.state : L.unknown, value(row?.image)];
    }))];
  } });
  if (include("users")) sources.push({ name: L.users, load: async () => {
    const { items: users, first } = await readAllPages<User>("/state/users", 25, read, active, user => user.id);
    return [table(L.users, [L.identifier, L.role, L.status, L.phone, L.created, L.lastLogin], users.map(user => [
      user.id, roleLabels[user.role as Role] ?? user.role, stateLabels[user.state] ?? user.state,
      value(user.phone), value(user.created_at), value(user.last_login),
    ])), keyedSheet(L.users + " · " + L.status, { expected: L.expected, returned: L.returned }, { expected: first.total, returned: users.length })];
  } });
  if (include("backups")) sources.push({ name: L.backups, load: async () => {
    const { items, first } = await readAllPages<Backup>("/state/backups", 100, read, active, row => row.id);
    return [table(L.backups, [L.identifier, L.created, L.bytes, L.image], items.map(row => [row.id, new Date(row.created_at * 1000).toISOString(), row.bytes, value(row.image)])),
      keyedSheet(L.scheduled, { scheduled: L.scheduled }, first)];
  } });
  if (include("releases")) sources.push({ name: L.releases, load: async () => {
    const data = await read<{ items: Release[] }>("/state/releases");
    return [table(L.releases, [L.version, L.hash, L.fetched], data.items.map(row => [row.tag, row.sha256, new Date(row.fetched_at * 1000).toISOString()]))];
  } });
  if (include("history")) {
    sources.push({ name: L.jobs, load: async () => {
      const { items } = await readAllPages<Job>("/jobs", 100, read, active, row => row.id);
      return [table(L.jobs, [L.identifier, L.actor, L.operation, L.target, L.status, L.created, L.finished, L.message, L.safetyBackup], items.map(row => [
        row.id, row.actor, actionLabels[row.operation.kind], value(row.operation.target), stateLabels[row.status],
        new Date(row.created * 1000).toISOString(), row.finished ? new Date(row.finished * 1000).toISOString() : L.empty,
        value(row.result?.message), value(row.result?.safety_backup),
      ]))];
    } });
    if (role === "owner") sources.push({ name: L.audit, load: async () => {
      const { items } = await readAllPages<Audit>("/audit", 100, read, active, row => row.id);
      return [table(L.audit, [L.identifier, L.actor, L.event, L.created], items.map(row => [row.id, row.actor, auditLabels[row.event] ?? row.event, new Date(row.created * 1000).toISOString()]))];
    } });
  }
  if (include("accounts") && role === "owner") sources.push({ name: L.accounts, load: async () => {
    const data = await read<{ items: Account[] }>("/accounts");
    return [table(L.accounts, [L.username, L.role, L.enabled, L.mfa, L.created], data.items.map(row => [
      row.username, roleLabels[row.role], Boolean(row.enabled), Boolean(row.mfa), new Date(row.created * 1000).toISOString(),
    ]))];
  } });
  if (include("logs") && role !== "viewer") for (const service of ["api", "db", "nginx"]) {
    sources.push({ name: L.logs + " · " + serviceLabels[service], load: async () => {
      const data = await read<{ text: string }>(`/state/logs?target=${service}`);
      return [table(L.logs + " · " + serviceLabels[service], [L.service, L.line, L.logText], data.text ? data.text.split(/\r?\n/).map((line, index) => [serviceLabels[service], index + 1, line]) : [])];
    } });
  }
  const results = await Promise.all(sources.map(async source => {
    try { return { source: source.name, sheets: await source.load(), error: false }; }
    catch (error) {
      if (error instanceof ManagementApiError && error.status === 401) throw error;
      return { source: source.name, sheets: [keyedSheet(source.name, { status: L.status }, { status: L.failed })], error: true };
    }
  }));
  if (!active()) throw new Error();
  const guide: ExcelSheet = { name: L.guide, columns: [L.field, L.value], rows: [
    [L.generated, new Date().toISOString()], [L.days, days], [L.role, roleLabels[role]],
    [L.allRows, true], [L.limits, true], [L.live, true],
    ...results.map(result => [result.source, result.error ? L.failed : L.measured]),
  ] };
  return { sheets: [guide, ...results.flatMap(result => result.sheets)], partial: results.some(result => result.error) };
};
