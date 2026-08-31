import { describe, expect, it } from "vitest";
import {
  sumByType,
  totalBalance,
  monthTotals,
  categoryBreakdown,
  dailyExpenses,
  sixMonthSeries,
} from "./report.rules";
import type { Transaction } from "../transaction/transaction.types";

const tx = (
  id: string,
  type: "expense" | "income",
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
  note: null,
  accountId: null,
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
});
