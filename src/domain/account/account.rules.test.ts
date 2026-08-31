import { describe, expect, it } from "vitest";
import {
  validateAccountInput,
  maskCardNumber,
  formatCardFa,
  formatSheba,
  normalizeSheba,
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

  it("بدون هیچ شماره → EMPTY_ACCOUNT", () => {
    expect(
      ok({ cardNumber: null, accountNumber: null, sheba: null }).error,
    ).toBe("EMPTY_ACCOUNT");
  });

  it("کارت ۱۵ رقمی → INVALID_CARD", () => {
    expect(ok({ cardNumber: "621986101234567" }).error).toBe("INVALID_CARD");
  });

  it("کارت با ارقام فارسی و جداکننده معتبر است", () => {
    expect(ok({ cardNumber: "۶۲۱۹-۸۶۱۰-۱۲۳۴-۵۶۷۸" }).ok).toBe(true);
  });

  it("شبا با IR کوچک هم قبول و نرمال می‌شود", () => {
    expect(normalizeSheba("ir062000000000171234567890")).toBe(
      "IR062000000000171234567890",
    );
    expect(
      ok({ cardNumber: null, sheba: "ir062000000000171234567890" }).ok,
    ).toBe(true);
  });

  it("شبا کوتاه → INVALID_SHEBA", () => {
    expect(ok({ cardNumber: null, sheba: "IR12345" }).error).toBe(
      "INVALID_SHEBA",
    );
  });

  it("حساب ۵ تا ۲۰ رقم", () => {
    expect(ok({ cardNumber: null, accountNumber: "123456789" }).ok).toBe(true);
    expect(ok({ cardNumber: null, accountNumber: "123" }).error).toBe(
      "INVALID_ACCOUNT_NO",
    );
  });

  it("عنوان خالی/بلند → INVALID_TITLE", () => {
    expect(ok({ title: "  " }).error).toBe("INVALID_TITLE");
    expect(ok({ title: "ط".repeat(41) }).error).toBe("INVALID_TITLE");
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

  it("formatSheba گروه‌بندی ۴تایی", () => {
    expect(formatSheba("IR062000000000171234567890")).toBe(
      "IR06 2000 0000 0017 1234 5678 90",
    );
  });
});
