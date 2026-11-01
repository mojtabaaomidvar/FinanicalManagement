import { describe, expect, it } from "vitest";
import {
  currencyFactor,
  currencyLabel,
  toDisplay,
  fromDisplay,
} from "./currency";

describe("تبدیل واحد پول", () => {
  it("تومان = ضریب ۱", () => {
    expect(currencyFactor("تومان")).toBe(1);
    expect(currencyFactor(null)).toBe(1);
    expect(toDisplay(150000, "تومان")).toBe(150000);
  });

  it("ریال = ۱۰× تومان", () => {
    expect(currencyFactor("ریال")).toBe(10);
    expect(toDisplay(150000, "ریال")).toBe(1500000);
  });

  it("رفت‌وبرگشت", () => {
    expect(fromDisplay(toDisplay(999999, "ریال"), "ریال")).toBe(999999);
    expect(fromDisplay(toDisplay(1200, "تومان"), "تومان")).toBe(1200);
  });

  it("ریال → تومان گرد صحیح", () => {
    expect(fromDisplay(1500000, "ریال")).toBe(150000);
  });

  /* برچسب باید همیشه هم‌داستانِ ضریب باشد: هر مقداری که ضریبش ۱ است باید
     «تومان» بخواند، وگرنه فایلِ خروجی عددِ یک واحد را با نامِ واحدِ دیگر
     نشان می‌دهد. */
  it("برچسب با ضریب هم‌خوان است", () => {
    expect(currencyLabel("ریال")).toBe("ریال");
    expect(currencyLabel("تومان")).toBe("تومان");
    for (const v of [null, undefined, "", "دلار"]) {
      expect(currencyLabel(v)).toBe("تومان");
      expect(currencyFactor(v)).toBe(1);
    }
  });
});
