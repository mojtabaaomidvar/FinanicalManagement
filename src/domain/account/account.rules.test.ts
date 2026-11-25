import { describe, expect, it } from "vitest";
import {
  validateAccountInput,
  validateAccountPatch,
  parseAccountBalance,
  MAX_ACCOUNT_BALANCE,
  maskCardNumber,
  formatCardFa,
  digitsOf,
} from "./account.rules";
import { addMoney, negateMoney } from "@/shared/lib/money";

const ok = (over: Partial<Parameters<typeof validateAccountInput>[0]> = {}) =>
  validateAccountInput({
    memberId: "m1",
    title: "کارت اصلی",
    cardNumber: "6219861012345678",
    ...over,
  });

describe("validateAccountInput", () => {
  it("ورودی سالم با کارت", () => expect(ok().ok).toBe(true));

  it("حساب بانکی بدون کارت → EMPTY_ACCOUNT", () => {
    expect(ok({ cardNumber: null }).error).toBe("EMPTY_ACCOUNT");
  });

  it("کارت ۱۵ رقمی → INVALID_CARD", () => {
    expect(ok({ cardNumber: "621986101234567" }).error).toBe("INVALID_CARD");
  });

  it("کارت با ارقام فارسی و جداکننده معتبر است", () => {
    expect(ok({ cardNumber: "۶۲۱۹-۸۶۱۰-۱۲۳۴-۵۶۷۸" }).ok).toBe(true);
  });

  it("عنوان خالی/بلند → INVALID_TITLE", () => {
    expect(ok({ title: "  " }).error).toBe("INVALID_TITLE");
    expect(ok({ title: "ط".repeat(41) }).error).toBe("INVALID_TITLE");
  });

  it("کیف‌پول بدون کارت معتبر است", () => {
    expect(ok({ kind: "wallet", cardNumber: null }).ok).toBe(true);
  });

  it("کیف‌پول با موجودی اولیه معتبر است؛ منفی → INVALID_INITIAL_BALANCE", () => {
    expect(
      ok({ kind: "wallet", cardNumber: null, initialBalance: "500000" }).ok,
    ).toBe(true);
    expect(
      ok({ kind: "wallet", cardNumber: null, initialBalance: "-1" }).error,
    ).toBe("INVALID_INITIAL_BALANCE");
  });

  it("rejects opening balances beyond the server bound and permits bounded negative patches", () => {
    expect(ok({ initialBalance: MAX_ACCOUNT_BALANCE }).ok).toBe(true);
    expect(ok({ initialBalance: addMoney(MAX_ACCOUNT_BALANCE, "1") }).error).toBe("INVALID_INITIAL_BALANCE");
    for (const initialBalance of ["Infinity", "NaN", addMoney(MAX_ACCOUNT_BALANCE, "1"), negateMoney(addMoney(MAX_ACCOUNT_BALANCE, "1"))]) {
      expect(validateAccountPatch({ id: "a1", kind: "wallet", title: "Wallet", initialBalance }).error).toBe("INVALID_INITIAL_BALANCE");
    }
    expect(validateAccountPatch({ id: "a1", kind: "wallet", title: "Wallet", initialBalance: negateMoney(MAX_ACCOUNT_BALANCE) }).ok).toBe(true);
  });
});

describe("account balance input", () => {
  it("accepts grouping and each digit set with the chosen display currency", () => {
    for (const raw of ["۱٬۲۵۰", "١,٢٥٠", "1,250", "۱۲۵۰"]) {
      expect(parseAccountBalance(raw, "تومان")).toBe("1250");
      expect(parseAccountBalance(raw, "ریال")).toBe("125");
    }
    expect(parseAccountBalance("", "تومان")).toBe("0");
    expect(parseAccountBalance("۰", "تومان")).toBe("0");
    expect(parseAccountBalance("۱٫۵", "تومان")).toBe("1.5");
    expect(parseAccountBalance("۱", "ریال")).toBe("0.1");
  });

  it("preserves invalid input rather than silently stripping letters, signs or decimals", () => {
    for (const raw of [",", "12abc5", "-100", "۱٫۵۵", "1+2", "9".repeat(30)]) expect(parseAccountBalance(raw, "تومان")).toBeNull();
    expect(parseAccountBalance(String(MAX_ACCOUNT_BALANCE), "تومان")).toBe(MAX_ACCOUNT_BALANCE);
    expect(parseAccountBalance(addMoney(MAX_ACCOUNT_BALANCE, "1"), "تومان")).toBeNull();
  });
});

describe("فرمت‌دهی", () => {
  it("digitsOf ارقام فارسی را تبدیل می‌کند", () => {
    expect(digitsOf("۱۲۳۴۵")).toBe("12345");
  });

  it("maskCardNumber فقط ۴ رقم آخر", () => {
    expect(maskCardNumber("6219861012345678")).toBe("•••• •••• •••• ۵۶۷۸");
  });

  it("formatCardFa گروه‌بندی ۴تایی", () => {
    expect(formatCardFa("6219861012345678")).toBe("۶۲۱۹ ۸۶۱۰ ۱۲۳۴ ۵۶۷۸");
  });
});
