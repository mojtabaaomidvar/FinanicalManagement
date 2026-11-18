import { describe, expect, it } from "vitest";
import { evaluateExpression, normalizeExpressionInput, expressionInputCaret, formatExpressionValue } from "../ui/CalcKeypad";

describe("keyboard amount input", () => {
  it("groups every operand without changing decimals, leading zeroes or incomplete input", () => {
    for (const [raw, expected] of [
      ["1234567", "۱,۲۳۴,۵۶۷"], ["1234+5678", "۱,۲۳۴+۵,۶۷۸"],
      ["-1234.005678*1000", "-۱,۲۳۴.۰۰۵۶۷۸×۱,۰۰۰"],
      ["0000123.45", "۰,۰۰۰,۱۲۳.۴۵"], ["1234.", "۱,۲۳۴."], ["1234+", "۱,۲۳۴+"],
      ["12345678901234567890", "۱۲,۳۴۵,۶۷۸,۹۰۱,۲۳۴,۵۶۷,۸۹۰"],
    ]) {
      expect(normalizeExpressionInput(raw)).toBe(expected);
      expect(normalizeExpressionInput(expected)).toBe(expected);
    }
    expect(evaluateExpression(normalizeExpressionInput("1234+5678.5"))).toBe(6912.5);
  });

  it("maps caret positions across regrouping and retains separator affinity", () => {
    expect(expressionInputCaret("1234", normalizeExpressionInput("1234"), 4)).toBe(5);
    expect(expressionInputCaret("12,9345", normalizeExpressionInput("12,9345"), 4)).toBe(3);
    expect(expressionInputCaret("1,234", normalizeExpressionInput("1,234"), 2)).toBe(2);
    expect(expressionInputCaret("1234+5678.25", normalizeExpressionInput("1234+5678.25"), 11)).toBe(13);
  });

  it("accepts keyboard operators and Persian or Arabic numeric separators", () => {
    expect(normalizeExpressionInput("12/3+2*4")).toBe("۱۲÷۳+۲×۴");
    expect(evaluateExpression(normalizeExpressionInput("12/3+2*4"))).toBe(12);
    expect(normalizeExpressionInput("١٬٢٠٠٫٥−٠٫٥")).toBe("۱,۲۰۰.۵-۰.۵");
    expect(evaluateExpression(normalizeExpressionInput("١٬٢٠٠٫٥−٠٫٥"))).toBe(1200);
  });

  it("keeps unsupported text and invalid arithmetic so they cannot become another amount", () => {
    for (const input of ["12/0", "12abc5", "۱۲ تومان", "1.2.3", "12+"]) {
      expect(evaluateExpression(normalizeExpressionInput(input))).toBeNull();
    }
    expect(normalizeExpressionInput("12abc5")).toBe("۱۲abc۵");
  });

  it("preserves fractional values when displaying an amount for editing or continuing calculations", () => {
    expect(formatExpressionValue(1.75)).toBe("۱.۷۵");
    for (const amount of [1.75, 0.0000001, 12000.5, 1 / 3]) {
      expect(evaluateExpression(formatExpressionValue(amount))).toBe(amount);
    }
  });
});

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
    expect(evaluateExpression("-۸+۱۰")).toBe(2);
    expect(evaluateExpression("-۲×۳+۱۰")).toBe(4);
    expect(evaluateExpression("-۲÷۲")).toBe(-1);
  });

  it("ورودی نامعتبر → null", () => {
    expect(evaluateExpression("")).toBeNull();
    expect(evaluateExpression("+۵")).toBeNull();
    expect(evaluateExpression("۵+")).toBeNull();
    expect(evaluateExpression("۵÷۰")).toBeNull();
    expect(evaluateExpression("abc")).toBeNull();
    expect(evaluateExpression("(۱+۲)")).toBeNull();
    expect(evaluateExpression("۱۲÷۰")).toBeNull();
    expect(evaluateExpression("۱۲+")).toBeNull();
    expect(evaluateExpression("1..2")).toBeNull();
    expect(evaluateExpression("1.2.3")).toBeNull();
    expect(evaluateExpression("--۱۲")).toBeNull();
    expect(evaluateExpression("۱۲×-۲")).toBeNull();
  });
});
