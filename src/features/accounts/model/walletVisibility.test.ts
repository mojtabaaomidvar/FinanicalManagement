import { describe, expect, it } from "vitest";
import type { Member } from "@/domain/family/family.types";
import type { Account } from "@/domain/account/account.types";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { accountBalances, wealthSeriesBetween } from "@/domain/report/report.rules";
import { isoToJalali } from "@/shared/lib/jalali";
import { canViewFamilyWallets, walletItemsForViewer } from "./walletVisibility";

const viewer = (role: Member["role"]) => ({ id: "self", familyId: "family", role });
const account = (id: string, memberId: string, initialBalance: number, familyId = "family"): Account => ({
  id, memberId, familyId, initialBalance: String(initialBalance), kind: "wallet", title: id, bank: null, cardNumber: null,
  smsEnabled: false, createdAt: "2026-11-21",
});
const accounts = [account("mine", "self", 100), account("other", "other", 900), account("foreign", "self", 5000, "foreign")];

describe("wallet page visibility", () => {
  it("members see their own accounts only, including when a previous family has the same owner id", () => {
    expect(walletItemsForViewer(accounts, viewer("member")).map(row => row.id)).toEqual(["mine"]);
    expect(canViewFamilyWallets(viewer("member"))).toBe(false);
  });
  it.each(["owner", "admin"] as const)("%s sees all accounts in the current family", role => {
    expect(walletItemsForViewer(accounts, viewer(role)).map(row => row.id)).toEqual(["mine", "other"]);
    expect(canViewFamilyWallets(viewer(role))).toBe(true);
  });
  it("fails closed while the viewer is missing", () => {
    expect(walletItemsForViewer(accounts, null)).toEqual([]);
    expect(walletItemsForViewer(accounts, { ...viewer("owner"), familyId: "" })).toEqual([]);
  });
  it("recomputes visibility after a manager loses the role without changing shared account data", () => {
    const actor = viewer("admin");
    expect(walletItemsForViewer(accounts, actor)).toHaveLength(2);
    actor.role = "member";
    expect(walletItemsForViewer(accounts, actor).map(row => row.id)).toEqual(["mine"]);
    expect(accounts).toHaveLength(3);
  });
  it("preserves incoming transfers from other members in personal balances and history", () => {
    const transfer = { id: "transfer", familyId: "family", memberId: "other", type: "transfer", amount: "25",
      category: "transfer", date: "2026-11-21", accountId: "other", toAccountId: "mine",
      time: null, note: null, subcategoryId: null, repeat: "none", repeatEnd: null, handledOccurrences: [],
      photos: [], createdAt: "2026-11-21" } satisfies Transaction;
    const visible = walletItemsForViewer(accounts, viewer("member"));
    expect(accountBalances([transfer], visible)[0].balance).toBe("125");
    const day = isoToJalali(transfer.date);
    expect(wealthSeriesBetween([transfer], day, day, "100", visible)).toEqual([{ date: transfer.date, value: "125" }]);
  });
  it("applies the same scope to asset rows so foreign holdings cannot enter personal wealth", () => {
    const holdings = [{ id: "mine", familyId: "family", memberId: "self", value: 50 },
      { id: "other", familyId: "family", memberId: "other", value: 10000 }];
    expect(walletItemsForViewer(holdings, viewer("member")).reduce((sum, row) => sum + row.value, 0)).toBe(50);
  });
});
