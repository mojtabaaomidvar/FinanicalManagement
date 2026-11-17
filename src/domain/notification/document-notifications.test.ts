import { describe, expect, it } from "vitest";
import { deriveNotifications, type DeriveInput } from "./notification.rules";
import { DEFAULT_NOTIFICATION_PREFS } from "./notification.types";
import type { HouseDocument } from "../document/document.types";
import { isoToJalali } from "@/shared/lib/jalali";

const document = (patch: Partial<HouseDocument> = {}): HouseDocument => ({
  id: "document-1", title: "ضمانت یخچال", category: "ضمانت‌نامه",
  visibility: "private", expiryDate: "2026-12-14", reminderEnabled: true,
  ownerId: "member-1", mimeType: "application/pdf", fileName: "warranty.pdf",
  fileSize: 200, revision: 1, createdAt: "2026-11-14T00:00:00Z",
  updatedAt: "2026-11-14T00:00:00Z", canEdit: true, canDelete: true,
  canChangeVisibility: true, ...patch,
});

const input = (documents: HouseDocument[], patch: Partial<DeriveInput> = {}): DeriveInput => ({
  txs: [], bills: [], events: [], joinRequests: [], inventory: [], shoppingLists: [],
  documents, memberId: "member-1", role: "member", prefs: DEFAULT_NOTIFICATION_PREFS,
  dismissed: new Set(), todayJ: isoToJalali("2026-11-14"), ...patch,
});

describe("document expiry reminders", () => {
  it("shows private reminders only to their owner, even for household administrators", () => {
    const documents = [document(), document({ id: "other", ownerId: "member-2" })];
    for (const role of ["member", "admin", "owner"] as const) {
      expect(deriveNotifications(input(documents, { role })).map((note) => note.id))
        .toEqual(["documents:document-1"]);
    }
  });

  it("includes an authorized shared document and requires a current member", () => {
    const shared = document({ visibility: "shared", ownerId: "member-2" });
    expect(deriveNotifications(input([shared]))[0]).toMatchObject({
      domain: "documents", severity: "soon", dateIso: "2026-12-14",
      dismissible: false, ref: { kind: "documents", documentId: shared.id },
    });
    expect(deriveNotifications(input([shared], { memberId: undefined }))).toEqual([]);
  });

  it("uses the default 30-day window and includes its final day", () => {
    const notes = deriveNotifications(input([
      document({ id: "overdue", expiryDate: "2026-11-13" }),
      document({ id: "today", expiryDate: "2026-11-14" }),
      document({ id: "boundary", expiryDate: "2026-12-14" }),
      document({ id: "later", expiryDate: "2026-12-15" }),
    ]));
    expect(notes.map((note) => [note.id, note.severity])).toEqual([
      ["documents:overdue", "overdue"], ["documents:today", "pending"],
      ["documents:boundary", "soon"],
    ]);
  });

  it("does not remind for undated documents or documents with reminders disabled", () => {
    expect(deriveNotifications(input([
      document({ expiryDate: null }), document({ reminderEnabled: false }),
    ]))).toEqual([]);
  });

  it("honors the domain toggle and the global notification toggle", () => {
    expect(deriveNotifications(input([document()], {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS,
        domains: { ...DEFAULT_NOTIFICATION_PREFS.domains, documents: false } },
    }))).toEqual([]);
    expect(deriveNotifications(input([document()], {
      prefs: { ...DEFAULT_NOTIFICATION_PREFS, enabled: false },
    }))).toEqual([]);
  });

  it("clears the reminder when a document is deleted, renewed or becomes private to another member", () => {
    expect(deriveNotifications(input([]))).toEqual([]);
    expect(deriveNotifications(input([document({ expiryDate: "2027-11-14" })]))).toEqual([]);
    expect(deriveNotifications(input([document({ ownerId: "member-2" })]))).toEqual([]);
    expect(deriveNotifications(input([document({ revision: 2 })]))[0].id)
      .toBe("documents:document-1");
  });

  it("applies a zero-day lead and crosses the Jalali year boundary correctly", () => {
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS,
      leadDays: { ...DEFAULT_NOTIFICATION_PREFS.leadDays, documents: 0 } };
    expect(deriveNotifications(input([document({ expiryDate: "2026-11-15" })], { prefs })))
      .toEqual([]);
    const yearBoundary = deriveNotifications(input([document({ expiryDate: "2027-03-21" })], {
      todayJ: isoToJalali("2027-03-20"),
      prefs: { ...prefs, leadDays: { ...prefs.leadDays, documents: 1 } },
    }));
    expect(yearBoundary[0]?.severity).toBe("soon");
  });

  it("fails closed for an unrecognized visibility instead of assuming shared access", () => {
    expect(deriveNotifications(input([
      document({ visibility: "restricted" as HouseDocument["visibility"] }),
    ]))).toEqual([]);
  });
});
