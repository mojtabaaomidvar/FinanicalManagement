import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestVehicleRepository } from "./vehicleRepository";
afterEach(() => vi.unstubAllGlobals());
const vehicle = {
  id: "vehicle", title: "خودروی خانواده", brand: null, model: null, plate: null,
  purchase_date: null, odometer: 50000, insurance_until: null, inspection_until: null,
  document_id: null, service_task_id: null, service_due_date: null, service_due_odometer: null,
  service_reminder_enabled: true, created_by: "member-a", revision: 1,
  created_at: "2026-11-15T08:00:00Z", updated_at: "2026-11-15T08:00:00Z", can_edit: true, can_delete: true, can_view_history: true,
};
const input = { title: "خودروی خانواده", odometer: 50000, serviceReminderEnabled: true };
const service = { performedOn: "2026-11-15", description: "تعویض روغن", performedOdometer: 50000, costAmount: 150000, accountId: "account" };
const record = { id: "record", vehicle_id: "vehicle", performed_on: service.performedOn, description: service.description,
  performed_odometer: 50000, next_due_date: null, next_due_odometer: null, transaction_id: "transaction",
  cost_amount: "150000.00", cost_status: "recorded", created_by: "member-a", created_at: vehicle.created_at };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
function setup() {
  vi.stubGlobal("navigator", { onLine: true });
  let token: string | null = "token-a";
  const getToken = vi.fn(async () => token);
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(vehicle));
  vi.stubGlobal("fetch", fetchMock);
  const provider = { getToken };
  const repo = new RestVehicleRepository(new RestClient(provider), provider);
  return { repo, fetchMock, getToken, setToken: (next: string | null) => { token = next; } };
}
describe("vehicle transport identity and financial service requests", () => {
  it("captures the gesture's bearer even when the active account changes during token preparation", async () => {
    const context = setup();
    let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input);
    context.setToken("token-b"); release("token-a");
    expect(await saving).toMatchObject({ createdBy: "member-a", canViewHistory: true });
    expect(context.fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer token-a" } });
    expect(context.getToken).toHaveBeenCalledOnce();
  });
  it("takes creation and history capabilities from the server without permissive defaults", async () => {
    const context = setup();
    context.fetchMock.mockImplementationOnce(async () => response({ vehicles: [{ ...vehicle, can_edit: false, can_delete: false, can_view_history: false }], can_create: false }));
    expect(await context.repo.list()).toMatchObject({ canCreate: false, vehicles: [{ canEdit: false, canDelete: false, canViewHistory: false, plate: null }] });
  });
  it("rejects all vehicle operations offline and missing-session service without any network access", async () => {
    const context = setup(); vi.stubGlobal("navigator", { onLine: false });
    for (const action of [() => context.repo.list(), () => context.repo.add(input), () => context.repo.update("vehicle", input, 1),
      () => context.repo.remove("vehicle", 1), () => context.repo.listServices("vehicle"), () => context.repo.addService("vehicle", service, 1, "operation")]) {
      await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    }
    expect(context.getToken).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true }); context.setToken(null);
    await expect(context.repo.addService("vehicle", service, 1, "operation")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });
  it("preserves expense and operation data on unchanged retry after losing a service response", async () => {
    const context = setup();
    context.fetchMock.mockRejectedValueOnce(new TypeError("response lost"));
    context.fetchMock.mockImplementationOnce(async () => response({ vehicle: { ...vehicle, revision: 2 }, record, replayed: true }));
    await expect(context.repo.addService("vehicle", service, 1, "same-operation")).rejects.toMatchObject({ code: "NETWORK" });
    expect(await context.repo.addService("vehicle", service, 1, "same-operation")).toMatchObject({ replayed: true, record: { costAmount: 150000, transactionId: "transaction", costStatus: "recorded" } });
    const requests = context.fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));
    expect(requests[0]).toEqual(requests[1]);
    expect(requests[0]).toMatchObject({ operation_id: "same-operation", cost_amount: 150000, account_id: "account", performed_odometer: 50000 });
  });
  it("copies the original service cost before asynchronous token preparation", async () => {
    const context = setup();
    let release!: (value: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    context.fetchMock.mockImplementationOnce(async () => response({ vehicle, record, replayed: false }));
    const selected = { ...service };
    const saving = context.repo.addService("vehicle", selected, 1, "operation");
    selected.costAmount = 999999; selected.accountId = "another-account";
    release("token-a"); await saving;
    expect(JSON.parse(context.fetchMock.mock.calls[0][1].body as string)).toMatchObject({ cost_amount: 150000, account_id: "account" });
  });
});
