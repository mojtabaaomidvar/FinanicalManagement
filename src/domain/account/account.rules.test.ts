import { describe, expect, it } from "vitest";
import {
  validateAccountInput,
  maskCardNumber,
  formatCardFa,
  digitsOf,
} from "./account.rules";

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
      ok({ kind: "wallet", cardNumber: null, initialBalance: 500_000 }).ok,
    ).toBe(true);
    expect(
      ok({ kind: "wallet", cardNumber: null, initialBalance: -1 }).error,
    ).toBe("INVALID_INITIAL_BALANCE");
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
