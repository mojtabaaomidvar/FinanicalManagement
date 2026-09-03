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
  wealthSeries,
  memberExpenseShare,
} from "./report.rules";
import { isoToJalali } from "@/shared/lib/jalali";
import type { Transaction } from "../transaction/transaction.types";

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
  amount,
  category,
  date,
  time: null,
  note: null,
  accountId: null,
  toAccountId: null,
  subcategoryId: null,
  repeat: "none",
  repeatEnd: null,
  photos: [],
  createdAt: "2025-01-01T00:00:00Z",
});

describe("محاسبات مالی گزارش", () => {
  const list = [
    tx("1", "income", 1_000_000, "salary", "2025-09-01"),
    tx("2", "expense", 250_000, "food", "2025-09-01"),
    tx("3", "expense", 100_000, "food", "2025-09-02"),
    tx("4", "expense", 50_000, "transport", "2025-09-02"),
  ];

  it("جمع نوع", () => {
    expect(sumByType(list, "income")).toBe(1_000_000);
    expect(sumByType(list, "expense")).toBe(400_000);
  });

  it("موجودی کل = درآمد − هزینه", () => {
    expect(totalBalance(list)).toBe(600_000);
  });

  it("انتقال در موجودی و جمع ماه اثری ندارد", () => {
    const withTransfer = [
      ...list,
      tx("t1", "transfer", 700_000, "transfer", "2025-09-02"),
    ];
    expect(totalBalance(withTransfer)).toBe(600_000);
    const t = monthTotals(withTransfer);
    expect(t.income).toBe(1_000_000);
    expect(t.expense).toBe(400_000);
  });

  it("جمع ماه", () => {
    const t = monthTotals(list);
    expect(t.income).toBe(1_000_000);
    expect(t.expense).toBe(400_000);
  });

  it("تجزیه دسته نزولی", () => {
    const cats = categoryBreakdown(list);
    expect(cats[0].id).toBe("food");
    expect(cats[0].value).toBe(350_000);
    expect(cats).toHaveLength(2);
  });

  it("هزینه روزانه مرتب", () => {
    /* 2025-09-01 = ۱۴۰۴/۰۶/۱۰ و 2025-09-02 = ۱۴۰۴/۰۶/۱۱ */
    const days = dailyExpenses(list);
    expect(days).toEqual([
      { day: 10, value: 250_000 },
      { day: 11, value: 150_000 },
    ]);
  });

  it("سری ۶ ماهه — قدیمی → جدید", () => {
    const s = sixMonthSeries(() => list, 1404, 6);
    expect(s.labels).toHaveLength(6);
    expect(s.income.every((v) => v === 1_000_000)).toBe(true);
  });

  it("لیست خالی — بدون خطا", () => {
    expect(totalBalance([])).toBe(0);
    expect(categoryBreakdown([])).toEqual([]);
    expect(dailyExpenses([])).toEqual([]);
  });

  it("جریان نقدی هفته — فقط ۷ روز منتهی به امروز", () => {
    /* امروز = ۱۴۰۴/۰۶/۱۵ → پنجره ۷ روزه: ۰۶/۰۹ تا ۰۶/۱۵ */
    const end = isoToJalali("2025-09-06"); /* ۱۴۰۴/۰۶/۱۵ */
    const list = [
      tx("1", "income", 500_000, "salary", "2025-09-06"),
      tx("2", "expense", 200_000, "food", "2025-09-06"),
      tx("3", "expense", 100_000, "food", "2025-09-01"), /* ۰۶/۱۰ — داخل پنجره */
      tx("4", "expense", 999_000, "transport", "2025-08-30"), /* خارج از پنجره */
    ];
    const w = weekFlow(list, end);
    expect(w.labels).toHaveLength(7);
    expect(w.totalIn).toBe(500_000);
    expect(w.totalOut).toBe(300_000);
    expect(w.net).toBe(200_000);
    /* روز آخر هفته = امروز */
    expect(w.income[6]).toBe(500_000);
    expect(w.expense[6]).toBe(200_000);
  });

  it("جریان نقدی — هفته خالی", () => {
    const w = weekFlow([], isoToJalali("2025-09-06"));
    expect(w.net).toBe(0);
    expect(w.income.every((v) => v === 0)).toBe(true);
  });

  it("موجودی حساب‌ها — انتقال مبدأ را کم و مقصد را زیاد می‌کند", () => {
    const acc = { id: "a1" } as never;
    const acc2 = { id: "a2" } as never;
    const list = [
      { ...tx("1", "income", 1_000_000, "salary", "2025-09-01"), accountId: "a1" },
      { ...tx("2", "expense", 200_000, "food", "2025-09-02"), accountId: "a1" },
      { ...tx("3", "transfer", 300_000, "transfer", "2025-09-03"), accountId: "a1", toAccountId: "a2" },
    ];
    const bals = accountBalances(list, [acc, acc2]);
    expect(bals[0].balance).toBe(500_000);
    expect(bals[1].balance).toBe(300_000);
  });

  it("سری ثروت — تجمعی روزانه، انتقال بی‌اثر", () => {
    const list = [
      tx("1", "income", 100_000, "salary", "2025-09-01"),
      tx("2", "expense", 30_000, "food", "2025-09-02"),
      { ...tx("3", "transfer", 999_000, "transfer", "2025-09-02") },
    ];
    const pts = wealthSeries(list, "7d", isoToJalali("2025-09-03"));
    expect(pts).toHaveLength(7);
    expect(pts[6].value).toBe(70_000);
    /* روز قبل از هر تراکنش: صفر */
    expect(pts[5].value).toBe(70_000);
  });

  it("سهم اعضا از هزینه — نزولی", () => {
    const list = [
      { ...tx("1", "expense", 100, "food", "2025-09-01"), memberId: "m2" },
      { ...tx("2", "expense", 400, "food", "2025-09-01"), memberId: "m1" },
      { ...tx("3", "income", 500, "salary", "2025-09-01"), memberId: "m1" },
    ];
    const share = memberExpenseShare(list);
    expect(share[0]).toEqual({ memberId: "m1", amount: 400 });
    expect(share).toHaveLength(2);
  });
});
