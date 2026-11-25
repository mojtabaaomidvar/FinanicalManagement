import { describe, expect, it } from "vitest";
import {
  sumByType,
  totalBalance,
  monthTotals,
  categoryBreakdown,
  dailyExpenses,
  sixMonthSeries,
  weekFlow,
  accountBalances,
  totalCashBalance,
  wealthSeries,
  wealthSeriesBetween,
  memberExpenseShare,
  deltaPercent,
  searchTransactions,
} from "./report.rules";
import { isoToJalali } from "@/shared/lib/jalali";
import type { Transaction } from "../transaction/transaction.types";
import { multiplyMoney } from "@/shared/lib/money";

const tx = (
  id: string,
  type: "expense" | "income" | "transfer",
  amount: number,
  category: string,
  date: string,
): Transaction => ({
  id,
  familyId: "f",
  memberId: "m1",
  type,
  amount: String(amount),
  category,
  date,
  time: null,
  note: null,
  accountId: null,
  toAccountId: null,
  subcategoryId: null,
  repeat: "none",
  repeatEnd: null,
  handledOccurrences: [],
  photos: [],
  createdAt: "2025-01-01T00:00:00Z",
});

describe("transaction search", () => {
  const rows = [
    { ...tx("food", "expense", 1250000, "food", "2026-11-18"), note: "خرید کیک", memberId: "m1" },
    { ...tx("fraction", "expense", 1200.5, "food", "2026-11-17"), note: "Cafe Receipt", memberId: "m2" },
  ];
  const memberName = (id: string) => id === "m1" ? "علی" : "مریم";

  it("searches the stored label without replacing its name or the transaction note", () => {
    const labelOf = (transaction: Transaction) => transaction.id === "food" ? "كيك مراسم" : "";
    expect(searchTransactions(rows, "کیک مراسم", memberName, undefined, undefined, labelOf).map(row => row.id)).toEqual(["food"]);
    expect(searchTransactions(rows, "کیک مراسم", memberName).map(row => row.id)).toEqual([]);
    expect(rows[0].note).toBe("خرید کیک");
    expect(labelOf(rows[0])).toBe("كيك مراسم");
  });

  it("finds the same amount with Persian, Arabic and English digits and grouping", () => {
    for (const query of ["1250000", "1,250,000", "۱۲۵۰۰۰۰", "۱٬۲۵۰٬۰۰۰", "١٢٥٠٠٠٠"]) {
      expect(searchTransactions(rows, query, memberName).map(row => row.id)).toEqual(["food"]);
    }
  });

  it("matches Arabic keyboard variants and English case without editing stored text", () => {
    expect(searchTransactions(rows, "كيك", memberName).map(row => row.id)).toEqual(["food"]);
    expect(searchTransactions(rows, "علي", memberName).map(row => row.id)).toEqual(["food"]);
    expect(searchTransactions(rows, "cafe receipt", memberName).map(row => row.id)).toEqual(["fraction"]);
    expect(rows[0].note).toBe("خرید کیک");
    expect(rows[1].note).toBe("Cafe Receipt");
  });

  it("preserves decimal amounts and finds the amount in the displayed unit", () => {
    expect(searchTransactions(rows, "۱٬۲۰۰٫۵", memberName).map(row => row.id)).toEqual(["fraction"]);
    expect(searchTransactions(rows, "12,005", memberName, undefined, row => multiplyMoney(row.amount, "10")).map(row => row.id)).toEqual(["fraction"]);
    expect(searchTransactions(rows, "1200.5", memberName, undefined, row => multiplyMoney(row.amount, "10"))).toEqual([]);
  });

  it("matches the Jalali date with either digit set and retains category search", () => {
    expect(searchTransactions(rows, "1405/08/27", memberName).map(row => row.id)).toEqual(["food"]);
    expect(searchTransactions(rows, "۱۴۰۵/۰۸/۲۷", memberName).map(row => row.id)).toEqual(["food"]);
    expect(searchTransactions(rows, "خورد و خوراک", memberName)).toHaveLength(2);
  });

  it("keeps an empty query unchanged and returns no results for unmatched text", () => {
    expect(searchTransactions(rows, "  ", memberName)).toBe(rows);
    expect(searchTransactions(rows, "no such receipt", memberName)).toEqual([]);
  });
});

describe("محاسبات مالی گزارش", () => {
  const list = [
    tx("1", "income", 1_000_000, "salary", "2025-09-01"),
    tx("2", "expense", 250_000, "food", "2025-09-01"),
    tx("3", "expense", 100_000, "food", "2025-09-02"),
    tx("4", "expense", 50_000, "transport", "2025-09-02"),
  ];

  it("جمع نوع", () => {
    expect(sumByType(list, "income")).toBe("1000000");
    expect(sumByType(list, "expense")).toBe("400000");
  });

  it("موجودی کل = درآمد − هزینه", () => {
    expect(totalBalance(list)).toBe("600000");
  });

  it("cash includes opening balances and internal transfers preserve the total", () => {
    const accounts = [{ id: "a1", initialBalance: "1000" }, { id: "a2", initialBalance: "200" }] as never;
    const rows = [
      { ...tx("income", "income", 300, "salary", "2026-11-18"), accountId: "a1" },
      { ...tx("expense", "expense", 100, "food", "2026-11-18"), accountId: "a1" },
      { ...tx("transfer", "transfer", 70, "transfer", "2026-11-18"), accountId: "a1", toAccountId: "a2" },
      tx("unassigned", "expense", 900, "food", "2026-11-18"),
    ];
    expect(totalCashBalance([], accounts)).toBe("1200");
    expect(totalCashBalance(rows, accounts)).toBe("1400");
    expect(monthTotals(rows).expense).toBe("1000");
    expect(totalCashBalance(rows, [])).toBe("0");
  });

  it("editing or deleting an expense updates cash by that expense's actual change", () => {
    const accounts = [{ id: "a1", initialBalance: "2500000" }] as never;
    const expense = { ...tx("expense", "expense", 12000, "food", "2026-11-18"), accountId: "a1" };
    expect(totalCashBalance([expense], accounts)).toBe("2488000");
    expect(totalCashBalance([{ ...expense, amount: "2000" }], accounts)).toBe("2498000");
    expect(totalCashBalance([], accounts)).toBe("2500000");
  });

  it("انتقال در موجودی و جمع ماه اثری ندارد", () => {
    const withTransfer = [
      ...list,
      tx("t1", "transfer", 700_000, "transfer", "2025-09-02"),
    ];
    expect(totalBalance(withTransfer)).toBe("600000");
    const t = monthTotals(withTransfer);
    expect(t.income).toBe("1000000");
    expect(t.expense).toBe("400000");
  });

  it("جمع ماه", () => {
    const t = monthTotals(list);
    expect(t.income).toBe("1000000");
    expect(t.expense).toBe("400000");
  });

  it("تجزیه دسته نزولی", () => {
    const cats = categoryBreakdown(list);
    expect(cats[0].id).toBe("food");
    expect(cats[0].value).toBe("350000");
    expect(cats).toHaveLength(2);
  });

  it("هزینه روزانه مرتب", () => {
    /* 2025-09-01 = ۱۴۰۴/۰۶/۱۰ و 2025-09-02 = ۱۴۰۴/۰۶/۱۱ */
    const days = dailyExpenses(list);
    expect(days).toEqual([
      { day: 10, value: "250000" },
      { day: 11, value: "150000" },
    ]);
  });

  it("سری ۶ ماهه — قدیمی → جدید", () => {
    const s = sixMonthSeries(() => list, 1404, 6);
    expect(s.labels).toHaveLength(6);
    expect(s.income.every((v) => v === "1000000")).toBe(true);
  });

  it("لیست خالی — بدون خطا", () => {
    expect(totalBalance([])).toBe("0");
    expect(categoryBreakdown([])).toEqual([]);
    expect(dailyExpenses([])).toEqual([]);
  });

  it("جریان نقدی هفته — فقط ۷ روز منتهی به امروز", () => {
    /* امروز = ۱۴۰۴/۰۶/۱۵ → پنجره ۷ روزه: ۰۶/۰۹ تا ۰۶/۱۵ */
    const end = isoToJalali("2025-09-06"); /* ۱۴۰۴/۰۶/۱۵ */
    const list = [
      tx("1", "income", 500_000, "salary", "2025-09-06"),
      tx("2", "expense", 200_000, "food", "2025-09-06"),
      tx(
        "3",
        "expense",
        100_000,
        "food",
        "2025-09-01",
      ) /* ۰۶/۱۰ — داخل پنجره */,
      tx(
        "4",
        "expense",
        999_000,
        "transport",
        "2025-08-30",
      ) /* خارج از پنجره */,
    ];
    const w = weekFlow(list, end);
    expect(w.labels).toHaveLength(7);
    expect(w.totalIn).toBe("500000");
    expect(w.totalOut).toBe("300000");
    expect(w.net).toBe("200000");
    /* روز آخر هفته = امروز */
    expect(w.income[6]).toBe("500000");
    expect(w.expense[6]).toBe("200000");
  });

  it("جریان نقدی — هفته خالی", () => {
    const w = weekFlow([], isoToJalali("2025-09-06"));
    expect(w.net).toBe("0");
    expect(w.income.every((v) => v === "0")).toBe(true);
  });

  it("transfers never increase weekly spending or change weekly net income", () => {
    const list = [
      tx("in", "income", 100, "salary", "2025-09-06"),
      tx("out", "expense", 40, "food", "2025-09-06"),
      { ...tx("move", "transfer", 900, "transfer", "2025-09-06"), accountId: "a1", toAccountId: "a2" },
    ];
    const flow = weekFlow(list, isoToJalali("2025-09-06"));
    expect(flow.totalIn).toBe("100");
    expect(flow.totalOut).toBe("40");
    expect(flow.expense[6]).toBe("40");
    expect(flow.net).toBe("60");
  });

  it("cash history matches remaining accounts, including transfer legs and unassigned records", () => {
    const accounts = [{ id: "a1", initialBalance: "250" }, { id: "a2", initialBalance: "-10" }] as never[];
    const list = [
      { ...tx("in", "income", 100, "salary", "2025-09-01"), accountId: "a1" },
      { ...tx("out", "expense", 40, "food", "2025-09-02"), accountId: "a2" },
      { ...tx("move", "transfer", 50, "transfer", "2025-09-02"), accountId: "a1", toAccountId: "a2" },
      tx("unassigned", "expense", 9999, "food", "2025-09-02"),
      { ...tx("deleted", "income", 8888, "salary", "2025-09-02"), accountId: "deleted" },
      { ...tx("partial-out", "transfer", 15, "transfer", "2025-09-03"), accountId: "a1", toAccountId: null },
      { ...tx("partial-in", "transfer", 5, "transfer", "2025-09-03"), accountId: null, toAccountId: "a2" },
    ];
    const from = isoToJalali("2025-09-02"), end = isoToJalali("2025-09-03");
    expect(wealthSeries(list, "7d", end, "240", accounts).at(-1)?.value).toBe(totalCashBalance(list, accounts));
    expect(wealthSeriesBetween(list, from, end, "240", accounts).map(point => point.value)).toEqual(["300", "290"]);
    expect(wealthSeriesBetween(list, from, end, "0", []).map(point => point.value)).toEqual(["0", "0"]);
    expect(wealthSeriesBetween([...list, { ...tx("future", "expense", 50, "food", "2025-09-04"), accountId: "a1" }], from, end, "240", accounts).at(-1)?.value).toBe("290");
  });

  it("موجودی حساب‌ها — انتقال مبدأ را کم و مقصد را زیاد می‌کند", () => {
    const acc = { id: "a1" } as never;
    const acc2 = { id: "a2" } as never;
    const list = [
      {
        ...tx("1", "income", 1_000_000, "salary", "2025-09-01"),
        accountId: "a1",
      },
      { ...tx("2", "expense", 200_000, "food", "2025-09-02"), accountId: "a1" },
      {
        ...tx("3", "transfer", 300_000, "transfer", "2025-09-03"),
        accountId: "a1",
        toAccountId: "a2",
      },
    ];
    const bals = accountBalances(list, [acc, acc2]);
    expect(bals[0].balance).toBe("500000");
    expect(bals[1].balance).toBe("300000");
  });

  it("سری دارایی — تجمعی روزانه، انتقال بی‌اثر", () => {
    const list = [
      tx("1", "income", 100_000, "salary", "2025-09-01"),
      tx("2", "expense", 30_000, "food", "2025-09-02"),
      { ...tx("3", "transfer", 999_000, "transfer", "2025-09-02") },
    ];
    const pts = wealthSeries(list, "7d", isoToJalali("2025-09-03"));
    expect(pts).toHaveLength(7);
    expect(pts[6].value).toBe("70000");
    /* روز قبل از هر تراکنش: صفر */
    expect(pts[5].value).toBe("70000");
  });

  it("سری دارایی بازه دلخواه — از/تای مشخص، تجمعی از قبل بازه هم حساب است", () => {
    const list = [
      tx("1", "income", 100_000, "salary", "2025-09-01"),
      tx("2", "expense", 30_000, "food", "2025-09-10"),
    ];
    const pts = wealthSeriesBetween(
      list,
      isoToJalali("2025-09-05"),
      isoToJalali("2025-09-08"),
    );
    expect(pts).toHaveLength(4);
    expect(pts[0].date).toBe("2025-09-05");
    expect(pts[3].date).toBe("2025-09-08");
    /* درآمد ۱م قبل از بازه است و در دارایی هست؛ هزینه ۱۰م هنوز نه */
    expect(pts[0].value).toBe("100000");
    expect(pts[3].value).toBe("100000");
  });

  it("سری دارایی بازه دلخواه — تک‌روز = یک نقطه", () => {
    const pts = wealthSeriesBetween(
      [tx("1", "income", 50_000, "salary", "2025-09-01")],
      isoToJalali("2025-09-03"),
      isoToJalali("2025-09-03"),
    );
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ date: "2025-09-03", value: "50000" });
  });

  it("موجودی حساب‌ها — موجودی اولیه مبنا است", () => {
    const acc = {
      id: "a1",
      kind: "wallet",
      initialBalance: "500000",
    } as never;
    const list = [tx("1", "expense", 100_000, "food", "2025-09-02")];
    list[0].accountId = "a1";
    const bals = accountBalances(list, [acc]);
    expect(bals[0].balance).toBe("400000");
  });

  it("سری دارایی — مبنای اولیه در همه نقاط هست", () => {
    const list = [tx("1", "income", 100_000, "salary", "2025-09-01")];
    const pts = wealthSeries(list, "7d", isoToJalali("2025-09-03"), "250000");
    expect(pts[0].value).toBe("250000");
    expect(pts[6].value).toBe("350000");
  });

  it("سهم اعضا از هزینه — نزولی", () => {
    const list = [
      { ...tx("1", "expense", 100, "food", "2025-09-01"), memberId: "m2" },
      { ...tx("2", "expense", 400, "food", "2025-09-01"), memberId: "m1" },
      { ...tx("3", "income", 500, "salary", "2025-09-01"), memberId: "m1" },
    ];
    const share = memberExpenseShare(list);
    expect(share[0]).toEqual({ memberId: "m1", amount: "400" });
    expect(share).toHaveLength(2);
  });

  it("درصد تغییر نسبت به بازه قبل", () => {
    expect(deltaPercent("150", "100")).toBe(50);
    expect(deltaPercent("80", "100")).toBe(-20);
    expect(deltaPercent("100", "100")).toBe(0);
    /* مبنای صفر قابل مقایسه نیست */
    expect(deltaPercent("500", "0")).toBeNull();
    /* گرد کردن متقارن: کاهش و افزایش هم‌اندازه، عدد یکسان می‌دهد */
    expect(deltaPercent("300", "800")).toBe(-63);
    expect(deltaPercent("1300", "800")).toBe(63);
  });
});
