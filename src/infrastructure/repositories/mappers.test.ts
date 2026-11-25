import { describe, expect, it } from "vitest";
import { mapMember, mapTransaction, mapEvent, mapSms, type MemberRow, type TransactionRow, type EventRow, type SmsRow } from "./mappers";

const row: MemberRow = {
  id: "second-admin", family_id: "family", name: "مدیر دوم", role: "admin",
  phone: null, gender: null, birth_date: null, avatar_url: null, status: "active",
  membership_state: "active", theme: "auto", relation: "سایر", currency: "تومان",
  created_at: "2026-11-14T00:00:00Z",
};

describe("member role mapping", () => {
  it("retains both server admin roles for task permissions", () => {
    expect(mapMember(row).role).toBe("admin");
    expect(mapMember({ ...row, role: "owner" }).role).toBe("owner");
  });

  it("does not grant admin privileges to unknown roles or memberships", () => {
    expect(mapMember({ ...row, role: "unknown" }).role).toBe("member");
    expect(mapMember({ ...row, membership_state: undefined }).membershipState).toBeNull();
  });
});

describe("SMS timestamp and provenance mapping", () => {
  const sms: SmsRow = { id: "sms", family_id: "family", member_id: "self", raw_text: "original message",
    bank: null, type: "expense", amount: "250000", balance: null, date: null, status: "pending",
    received_at: "2026-11-25T20:00:00Z", created_at: "2026-11-26T00:00:00Z" };
  it("keeps an unknown event timestamp null regardless of receipt and storage time", () => {
    expect(mapSms(sms)).toMatchObject({ date: null, time: null, receivedAt: sms.received_at,
      createdAt: sms.created_at, rawText: sms.raw_text, amount: 250000 });
  });
  it("retains explicit event seconds and transport/link metadata without changing the body", () => {
    expect(mapSms({ ...sms, date: "2026-11-24", time: "14:37:52", transport_id: "delivery",
      parser_version: "deterministic-v2", transaction_id: "tx" })).toMatchObject({
      date: "2026-11-24", time: "14:37:52", transportId: "delivery", parserVersion: "deterministic-v2",
      transactionId: "tx", receivedAt: sms.received_at, rawText: sms.raw_text });
  });
});

describe("calendar activity metadata", () => {
  const event: EventRow = { id: "shared-record", family_id: "family", member_id: "creator", for_member_id: null,
    title: "گردش", date: "2026-11-15", note: null, created_at: "2026-11-15T00:00:00Z" };
  it("keeps legacy events neutral and compatible when additive fields are absent", () => {
    expect(mapEvent(event)).toMatchObject({ id: event.id, date: event.date, familyId: "family", kind: "event", activityStatus: null, reminderEnabled: false, revision: 1 });
  });
  it("retains the activity's exact calendar identity, status and revision", () => {
    expect(mapEvent({ ...event, kind: "activity", activity_status: "cancelled", reminder_enabled: true, revision: 7 }))
      .toMatchObject({ id: event.id, date: event.date, kind: "activity", activityStatus: "cancelled", reminderEnabled: true, revision: 7 });
  });
});

describe("vehicle service finance provenance", () => {
  const transaction: TransactionRow = {
    id: "tx", family_id: "family", member_id: "adult", type: "expense", amount: "50000",
    category: "transport", date: "2026-11-15", time: null, note: null,
    account_id: null, subcategory_id: null, created_at: "2026-11-15T00:00:00Z",
  };
  it("retains the server source for editing rules without requiring an account", () => {
    expect(mapTransaction({ ...transaction, source_kind: "vehicle_service" })).toMatchObject({
      sourceKind: "vehicle_service", amount: "50000", accountId: null,
    });
  });
  it("retains online choice distinctly from legacy absence and maps fee snapshots", () => {
    expect(mapTransaction({ ...transaction, payment_method: "online" })).toMatchObject({ paymentMethod: "online", transferFeeRial: null });
    expect(mapTransaction(transaction).paymentMethod).toBeNull();
    expect(mapTransaction({ ...transaction, payment_method: "bank_transfer", transfer_fee_method: "paya", transfer_fee_rial: 4000 }))
      .toMatchObject({ paymentMethod: "bank_transfer", transferFeeMethod: "paya", transferFeeRial: "4000" });
  });
  it("keeps legacy and unknown transaction sources outside service-specific rules", () => {
    expect(mapTransaction(transaction).sourceKind).toBeNull();
    expect(mapTransaction({ ...transaction, source_kind: "unrecognized" }).sourceKind).toBeNull();
  });
});
