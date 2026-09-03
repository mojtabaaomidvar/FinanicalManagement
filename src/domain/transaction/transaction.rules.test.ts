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

  it("دسته: ثابت، سفارشی (uuid) یا نامعتبر", () => {
    /* دسته ثابت معتبر */
    expect(ok({ category: "food" }).ok).toBe(true);
    /* دسته سفارشی (uuid) معتبر — مالکیت نهایی در سرور چک می‌شود */
    expect(
      ok({ category: "123e4567-e89b-12d3-a456-426614174000" }).ok,
    ).toBe(true);
    /* ناشناخته و نه uuid */
    expect(ok({ category: " Salary! " }).error).toBe("INVALID_CATEGORY");
    expect(ok({ category: "" }).error).toBe("INVALID_CATEGORY");
  });

  it("تاریخ نامعتبر", () => {
    expect(ok({ date: "1404-06-15" }).error).toBe("INVALID_DATE");
    expect(ok({ date: "abc" }).error).toBe("INVALID_DATE");
  });

  it("نوع نامعتبر", () => {
    expect(ok({ type: "foo" as "expense" }).error).toBe("INVALID_TYPE");
  });

  it("انتقال: سالم — مبدأ و مقصد الزامی و متفاوت", () => {
    expect(
      ok({
        type: "transfer",
        category: "transfer",
        accountId: "a1",
        toAccountId: "a2",
      }).ok,
    ).toBe(true);
    /* بدون مقصد */
    expect(
      ok({
        type: "transfer",
        category: "transfer",
        accountId: "a1",
        toAccountId: null,
      }).error,
    ).toBe("INVALID_TRANSFER");
    /* مبدأ = مقصد */
    expect(
      ok({
        type: "transfer",
        category: "transfer",
        accountId: "a1",
        toAccountId: "a1",
      }).error,
    ).toBe("INVALID_TRANSFER");
  });

  it("تکرارشونده: تاریخ پایان الزامی، معتبر و بعد از تاریخ تراکنش", () => {
    /* بدون تکرار → بدون نیاز به پایان */
    expect(ok({ repeatEnd: null }).ok).toBe(true);
    /* تکرار + پایان معتبر */
    expect(
      ok({ repeat: "monthly", repeatEnd: "2025-10-06" }).ok,
    ).toBe(true);
    /* تکرار بدون پایان */
    expect(
      ok({ repeat: "monthly", repeatEnd: null }).error,
    ).toBe("INVALID_REPEAT_END");
    /* پایان قبل از تاریخ تراکنش */
    expect(
      ok({ repeat: "monthly", repeatEnd: "2025-09-01" }).error,
    ).toBe("INVALID_REPEAT_END");
    /* پایان مساوی تاریخ تراکنش مجاز است */
    expect(ok({ repeat: "monthly", repeatEnd: "2025-09-06" }).ok).toBe(true);
    /* پایان نامعتبر */
    expect(
      ok({ repeat: "weekly", repeatEnd: "1404/07/01" }).error,
    ).toBe("INVALID_REPEAT_END");
  });
});

const tx = (
  id: string,
  date: string,
  createdAt: string,
  time: string | null = null,
): Transaction => ({
  id,
  familyId: "f",
  memberId: "m1",
  type: "expense",
  amount: 100,
  category: "food",
  date,
  time,
  note: null,
  accountId: null,
  toAccountId: null,
  subcategoryId: null,
  repeat: "none",
  repeatEnd: null,
  photos: [],
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

  it("در یک روز: نزولی بر اساس ساعت ثبت", () => {
    const sorted = sortTxDesc([
      tx("a", "2025-09-06", "2025-09-06T20:00:00Z", "09:15"),
      tx("b", "2025-09-06", "2025-09-06T08:00:00Z", "18:40"),
      tx("c", "2025-09-06", "2025-09-06T09:00:00Z", "12:00"),
      tx("d", "2025-09-06", "2025-09-06T07:00:00Z", null),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["b", "c", "a", "d"]);
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
