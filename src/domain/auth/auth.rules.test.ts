import { describe, expect, it } from "vitest";
import { normalizePhone, isValidPassword, isValidOtpCode } from "./auth.rules";

describe("normalizePhone", () => {
  it("فرمت‌های مختلف ایرانی", () => {
    expect(normalizePhone("09123456789")).toBe("09123456789");
    expect(normalizePhone("+989123456789")).toBe("09123456789");
    expect(normalizePhone("00989123456789")).toBe("09123456789");
    expect(normalizePhone("989123456789")).toBe("09123456789");
    expect(normalizePhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("09123456789");
  });

  it("نامعتبر", () => {
    expect(normalizePhone("9123456789")).toBe("");
    expect(normalizePhone("0912")).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("رمز و OTP", () => {
  it("رمز حداقل ۴ کاراکتر", () => {
    expect(isValidPassword("1234")).toBe(true);
    expect(isValidPassword("123")).toBe(false);
  });

  it("کد OTP دقیقاً ۶ رقم", () => {
    expect(isValidOtpCode("123456")).toBe(true);
    expect(isValidOtpCode("۱۲۳۴۵۶")).toBe(true);
    expect(isValidOtpCode("12345")).toBe(false);
    expect(isValidOtpCode("1234567")).toBe(false);
  });
});
