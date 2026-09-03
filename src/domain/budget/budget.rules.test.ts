import { describe, expect, it } from "vitest";
import { budgetStatus, monthCategorySpend } from "./budget.rules";
import type { Transaction } from "../transaction/transaction.types";

function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    familyId: "f",
    memberId: "m",
    type: "expense",
    amount: 0,
    category: "food",
    date: "2026-06-01",
    time: null,
    note: null,
    accountId: null,
    subcategoryId: null,
    photos: [],
    createdAt: "2026-06-01T10:00:00Z",
    ...partial,
  };
}

describe("budgetStatus", () => {
  it("بدون بودجه → غیرفعال", () => {
    const s = budgetStatus(0, 500_000);
    expect(s.active).toBe(false);
    expect(s.percent).toBe(0);
  });

  it("زیر ۸۰٪ → ok", () => {
    expect(budgetStatus(1_000_000, 500_000).level).toBe("ok");
  });

  it("بین ۸۰ تا ۱۰۰ → warn", () => {
    const s = budgetStatus(1_000_000, 850_000);
    expect(s.level).toBe("warn");
    expect(s.percent).toBe(85);
  });

  it("بالای ۱۰۰ → over با درصد واقعی", () => {
    const s = budgetStatus(1_000_000, 1_400_000);
    expect(s.level).toBe("over");
    expect(s.percent).toBe(140);
  });

  it("سقف ۹۹۹٪", () => {
    expect(budgetStatus(1, 1_000_000).percent).toBe(999);
  });
});

describe("monthCategorySpend", () => {
  /* 2026-06-01 = ۱۴۰۵/۰۳/۱۱ و 2026-05-01 = ۱۴۰۵/۰۲/۱۱ */
  const txs = [
    tx({ category: "food", amount: 100, date: "2026-06-01" }),
    tx({ category: "food", amount: 50, date: "2026-06-20" }),
    tx({ category: "food", amount: 999, date: "2026-05-01" }),
    tx({ category: "bills", amount: 70, date: "2026-06-02" }),
    tx({ type: "income", category: "salary", amount: 5_000, date: "2026-06-03" }),
  ];

  it("فقط هزینه‌های همان ماه جلالی جمع می‌شود", () => {
    const spend = monthCategorySpend(txs, 1405, 3);
    expect(spend.get("food")).toBe(150);
    expect(spend.get("bills")).toBe(70);
    expect(spend.size).toBe(2);
  });

  it("ماه دیگر → خالی (ریست ماهانه)", () => {
    const spend = monthCategorySpend(txs, 1405, 2);
    expect(spend.get("food")).toBe(999);
    expect(spend.get("bills")).toBeUndefined();
  });
});
