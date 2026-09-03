import { describe, expect, it } from "vitest";
import { evaluateExpression } from "../ui/CalcKeypad";

describe("evaluateExpression — کیپد ماشین‌حساب", () => {
  it("عدد ساده", () => {
    expect(evaluateExpression("۱۲۳")).toBe(123);
    expect(evaluateExpression("1,200,000")).toBe(1200000);
  });

  it("چهار عمل اصلی", () => {
    expect(evaluateExpression("۱۰+۵")).toBe(15);
    expect(evaluateExpression("۱۰-۳")).toBe(7);
    expect(evaluateExpression("۶×۴")).toBe(24);
    expect(evaluateExpression("۹÷۳")).toBe(3);
  });

  it("اولویت ضرب/تقسیم بر جمع/تفریق", () => {
    expect(evaluateExpression("۲+۳×۴")).toBe(14);
    expect(evaluateExpression("۱۰-۴÷۲")).toBe(8);
    expect(evaluateExpression("۲×۳+۴×۵")).toBe(26);
  });

  it("زنجیره عملگرها", () => {
    expect(evaluateExpression("۱+۲+۳")).toBe(6);
    expect(evaluateExpression("۱۰۰-۲۰-۳۰")).toBe(50);
    expect(evaluateExpression("۲×۳×۴")).toBe(24);
  });

  it("ورودی نامعتبر → null", () => {
    expect(evaluateExpression("")).toBeNull();
    expect(evaluateExpression("+۵")).toBeNull();
    expect(evaluateExpression("۵+")).toBeNull();
    expect(evaluateExpression("۵÷۰")).toBeNull();
    expect(evaluateExpression("abc")).toBeNull();
    expect(evaluateExpression("(۱+۲)")).toBeNull();
  });
});
