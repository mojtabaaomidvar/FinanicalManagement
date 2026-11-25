import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { filterTransactions, validTransactionDateRange, type TxAdvFilter } from "./transactionFilters";

const row = (id: string, patch: Partial<Transaction> = {}): Transaction => ({
  id, familyId: "family", memberId: "member", type: "expense", amount: "10",
  accountId: "source", toAccountId: null, category: "food", date: "2026-11-24",
  time: null, note: null, subcategoryId: null, repeat: "none", repeatEnd: null,
  photos: [], handledOccurrences: [], createdAt: "2026-11-24T12:00:00Z", ...patch,
});
const clear: TxAdvFilter = { range: "all", accountId: "", categoryId: "" };
const ids = (rows: Transaction[]) => rows.map(tx => tx.id);

describe("fixed wallet transaction filters", () => {
  const source = row("source-expense");
  const transfer = row("transfer", { type: "transfer", toAccountId: "destination", transferFeeRial: "4000" });
  const fee = row("fee", { sourceKind: "transfer_fee", transferFeeForId: "transfer", amount: "400", category: "finance" });
  const destination = row("destination-income", { type: "income", accountId: "destination" });
  const unrelated = row("other", { accountId: "other" });
  const rows = [source, transfer, fee, destination, unrelated];

  it("keeps both sides of a transfer but never broadens a fixed scope after reset", () => {
    expect(ids(filterTransactions(rows, "all", clear, "source"))).toEqual([source.id, transfer.id]);
    expect(ids(filterTransactions(rows, "all", clear, "destination"))).toEqual([transfer.id, destination.id]);
    expect(ids(filterTransactions(rows, "all", { ...clear, accountId: "other" }, "source"))).toEqual([source.id, transfer.id]);
  });
  it("applies each transaction type inside the account scope", () => {
    expect(ids(filterTransactions(rows, "expense", clear, "source"))).toEqual([source.id]);
    expect(ids(filterTransactions(rows, "income", clear, "destination"))).toEqual([destination.id]);
    expect(ids(filterTransactions(rows, "transfer", clear, "destination"))).toEqual([transfer.id]);
  });
  it("uses inclusive dates, including a same-day interval", () => {
    const dated = [row("before", { date: "2026-11-22" }), row("start", { date: "2026-11-23" }),
      row("end", { date: "2026-11-24" }), row("after", { date: "2026-11-25" })];
    expect(ids(filterTransactions(dated, "all", { ...clear, fromDate: "2026-11-23", toDate: "2026-11-24" }, "source"))).toEqual(["start", "end"]);
    expect(ids(filterTransactions(dated, "all", { ...clear, fromDate: "2026-11-24", toDate: "2026-11-24" }, "source"))).toEqual(["end"]);
  });
  it("accepts open-ended bounds but rejects inverted or malformed dates", () => {
    expect(validTransactionDateRange("", "2026-11-24")).toBe(true);
    expect(validTransactionDateRange("2026-11-24", "")).toBe(true);
    for (const range of [["2026-11-25", "2026-11-24"], ["2026-02-30", ""], ["24/11/2026", ""]]) {
      expect(validTransactionDateRange(...range)).toBe(false);
      expect(filterTransactions(rows, "all", { ...clear, fromDate: range[0], toDate: range[1] }, "source")).toEqual([]);
    }
  });
  it("attributes a fee only to its source and keeps an orphaned fee visible", () => {
    expect(ids(filterTransactions(rows, "all", { ...clear, hasTransferFee: true }, "source"))).toEqual([transfer.id]);
    expect(filterTransactions(rows, "all", { ...clear, hasTransferFee: true }, "destination")).toEqual([]);
    expect(ids(filterTransactions([fee], "all", clear, "source"))).toEqual([fee.id]);
    expect(filterTransactions([fee], "all", clear, "destination")).toEqual([]);
  });
  it("combines category, date and type filters without changing the source rows", () => {
    const before = JSON.stringify(rows);
    expect(ids(filterTransactions(rows, "expense", { ...clear, categoryId: "food", fromDate: "2026-11-24" }, "source"))).toEqual([source.id]);
    expect(JSON.stringify(rows)).toBe(before);
  });
});
