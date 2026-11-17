import { afterEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "@/infrastructure/api/restClient";
import { RestEquipmentRepository } from "./equipmentRepository";

afterEach(() => vi.unstubAllGlobals());

const equipment = {
  id: "equipment", title: "یخچال", brand: null, model: null,
  purchase_date: null, warranty_until: null, warranty_document_id: null,
  service_task_id: null, service_due_date: null, service_reminder_enabled: true,
  created_by: "member-a", revision: 1, created_at: "2026-11-15T08:00:00Z",
  updated_at: "2026-11-15T08:00:00Z", can_edit: true, can_delete: true,
};
const input = { title: "یخچال", serviceReminderEnabled: true };
const service = { performedOn: "2026-11-15", description: "تعویض فیلتر", nextDueDate: null };
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function setup() {
  vi.stubGlobal("navigator", { onLine: true });
  let token: string | null = "token-a";
  const getToken = vi.fn(async () => token);
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => response(equipment));
  vi.stubGlobal("fetch", fetchMock);
  const provider = { getToken };
  const repo = new RestEquipmentRepository(new RestClient(provider), provider);
  return { repo, getToken, fetchMock, setToken: (next: string | null) => { token = next; } };
}

describe("online equipment transport", () => {
  it("binds an equipment creation to the starting account while token preparation is pending", async () => {
    const context = setup();
    let release!: (token: string) => void;
    context.getToken.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const saving = context.repo.add(input);
    context.setToken("token-b");
    release("token-a");
    expect(await saving).toMatchObject({ id: "equipment", createdBy: "member-a", canEdit: true });
    const request = context.fetchMock.mock.calls[0][1];
    expect(request.headers).toMatchObject({ Authorization: "Bearer token-a" });
    expect(request.cache).toBe("no-store");
    expect(context.getToken).toHaveBeenCalledOnce();
  });

  it("rejects all equipment operations offline before reading a session or sending a request", async () => {
    const context = setup();
    vi.stubGlobal("navigator", { onLine: false });
    for (const action of [
      () => context.repo.list(), () => context.repo.add(input),
      () => context.repo.update("equipment", input, 1), () => context.repo.remove("equipment", 1),
      () => context.repo.listMaintenance("equipment"),
      () => context.repo.addMaintenance("equipment", service, 1, "operation"),
    ]) await expect(action()).rejects.toMatchObject({ code: "NETWORK" });
    expect(context.getToken).not.toHaveBeenCalled();
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("does not send an unauthenticated mutation when the stored session is missing", async () => {
    const context = setup();
    context.setToken(null);
    await expect(context.repo.addMaintenance("equipment", service, 1, "operation")).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the caller's service operation id and request body after a lost response", async () => {
    const context = setup();
    context.fetchMock.mockRejectedValueOnce(new TypeError("response lost"));
    context.fetchMock.mockImplementationOnce(async () => response({
      equipment: { ...equipment, revision: 2 },
      record: { id: "record", equipment_id: "equipment", performed_on: service.performedOn,
        description: service.description, next_due_date: null, created_by: "member-a", created_at: equipment.created_at },
      replayed: true,
    }));
    await expect(context.repo.addMaintenance("equipment", service, 1, "same-operation")).rejects.toMatchObject({ code: "NETWORK" });
    expect(await context.repo.addMaintenance("equipment", service, 1, "same-operation")).toMatchObject({ replayed: true, equipment: { revision: 2 } });
    expect(context.fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string))).toEqual([
      { operation_id: "same-operation", base_revision: 1, performed_on: service.performedOn, description: service.description, next_due_date: null },
      { operation_id: "same-operation", base_revision: 1, performed_on: service.performedOn, description: service.description, next_due_date: null },
    ]);
  });
});
