import { describe, expect, it } from "vitest";
import { validateTransaction, sortTxDesc, txsInJalaliMonth } from "./transaction.rules";
import type { Transaction } from "./transaction.types";

const ok = (over: Partial<Parameters<typeof validateTransaction>[0]> = {}) =>
  validateTransaction({
    memberId: "m1",
    type: "expense",
    amount: 1000,
    category: "food",
    date: "2025-09-06",
    ...over,
  });

describe("validateTransaction", () => {
  it("ورودی سالم", () => expect(ok().ok).toBe(true));

  it("مبلغ صفر/منفی/غیرعددی → INVALID_AMOUNT", () => {
    expect(ok({ amount: 0 }).error).toBe("INVALID_AMOUNT");
    expect(ok({ amount: -5 }).error).toBe("INVALID_AMOUNT");
    expect(ok({ amount: NaN }).error).toBe("INVALID_AMOUNT");
  });

  it("دسته نامعتبر برای نوع → INVALID_CATEGORY", () => {
    /* salary دسته درآمد است؛ در هزینه مجاز نیست */
    expect(ok({ category: "salary" }).error).toBe("INVALID_CATEGORY");
    expect(ok({ type: "income", category: "salary" }).ok).toBe(true);
  });

  it("تاریخ نامعتبر", () => {
    expect(ok({ date: "1404-06-15" }).error).toBe("INVALID_DATE");
    expect(ok({ date: "abc" }).error).toBe("INVALID_DATE");
  });

  it("نوع نامعتبر", () => {
    expect(ok({ type: "transfer" as "expense" }).error).toBe("INVALID_TYPE");
  });
});

const tx = (id: string, date: string, createdAt: string): Transaction => ({
  id,
  familyId: "f",
  memberId: "m1",
  type: "expense",
  amount: 100,
  category: "food",
  date,
  note: null,
  createdAt,
});

describe("sortTxDesc", () => {
  it("نزولی بر اساس تاریخ سپس ایجاد", () => {
    const sorted = sortTxDesc([
      tx("a", "2025-09-01", "2025-09-01T10:00:00Z"),
      tx("b", "2025-09-06", "2025-09-06T08:00:00Z"),
      tx("c", "2025-09-06", "2025-09-06T09:00:00Z"),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });
});

describe("txsInJalaliMonth", () => {
  it("فیلتر ماه جلالی", () => {
    /* 2025-09-06 = 1404/06/15 ؛ 2025-09-23 = 1404/07/01 */
    const list = [tx("a", "2025-09-06", "x"), tx("b", "2025-09-23", "y")];
    expect(txsInJalaliMonth(list, 1404, 6).map((t) => t.id)).toEqual(["a"]);
    expect(txsInJalaliMonth(list, 1404, 7).map((t) => t.id)).toEqual(["b"]);
  });
});
