import { describe, expect, it } from "vitest";
import { absMoney, addMoney, subtractMoney, compareMoney, convertMoney, divideMoney, floorMoneyPerDay, formatMoney, legacyBudgetInteger, legacyIntegerMoney, moneyFits, moneyRatio, multiplyMoney, negateMoney, normalizeMoney, parseMoneyInput } from "./money";

describe("exact wallet money", () => {
  it("uses exact finite division and explicit daily display flooring", () => {
    expect(divideMoney("0", "3")).toBe("0");
    expect(divideMoney("1", "8")).toBe("0.125");
    expect(divideMoney("1", "-2")).toBe("-0.5");
    expect(divideMoney("-1.5", "0.3")).toBe("-5");
    expect(divideMoney("1", "3")).toBeNull();
    expect(divideMoney("1", "0")).toBeNull();
    expect(floorMoneyPerDay("10.9", 3)).toBe("3");
    expect(floorMoneyPerDay("-10.9", 3)).toBe("-4");
    expect(() => floorMoneyPerDay("1", 0)).toThrow();
  });
  it("bounds only presentation ratios, never amounts", () => {
    expect(moneyRatio("1", "2")).toBe(0.5);
    expect(moneyRatio("-1", "2")).toBe(-0.5);
    expect(moneyRatio("1", "0")).toBe(0);
    const large = "9".repeat(100);
    expect(Number.isFinite(moneyRatio(large, "0.01"))).toBe(true);
    expect(moneyRatio(large, "0.01")).toBeGreaterThan(999);
    expect(moneyRatio(large, "-0.01")).toBeLessThan(-999);
    expect(large).toBe("9".repeat(100));
  });
  it("rejects unsafe or fractional legacy numeric boundaries", () => {
    expect(legacyIntegerMoney(123)).toBe("123");
    for (const amount of [0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(() => legacyIntegerMoney(amount)).toThrow();
    expect(legacyBudgetInteger("123")).toBe(123);
    for (const amount of ["1.1", "-1", "9007199254740992"]) expect(() => legacyBudgetInteger(amount)).toThrow();
  });
  it("retains one rial, legacy tenths of rial and sign in both units", () => {
    expect(convertMoney("1499.9", "ریال")).toBe("14999");
    expect(formatMoney("1499.9", "تومان")).toBe("۱,۴۹۹.۹");
    expect(formatMoney("1.01", "ریال")).toBe("۱۰.۱");
    expect(formatMoney("-1.1", "ریال")).toBe("-۱۱");
    expect(parseMoneyInput("۱۴٬۹۹۹", "ریال")).toBe("1499.9");
  });
  it("never passes large values or additions through a binary float", () => {
    expect(addMoney("999999999999999.9", "0.1")).toBe("1000000000000000");
    expect(subtractMoney("1000000000000000", "0.01")).toBe("999999999999999.99");
    expect(addMoney(...Array(1000).fill("0.1"))).toBe("100");
    expect(compareMoney("9007199254740993", "9007199254740992")).toBe(1);
    expect(formatMoney("999999999999999.9", "ریال")).toBe("۹,۹۹۹,۹۹۹,۹۹۹,۹۹۹,۹۹۹");
  });
  it("rejects unsupported syntax instead of stripping it into another balance", () => {
    for (const raw of ["1+2", "1-2", "NaN", "Infinity", "1e9", "1.234", "۱۲/۳", ""]) {
      expect(parseMoneyInput(raw, "تومان")).toBeNull();
    }
    expect(parseMoneyInput("-۱۲٫۳", "تومان")).toBe("-12.3");
    expect(parseMoneyInput("1.1", "ریال")).toBe("0.11");
  });

  it.each([
    ["0", "0"], ["-0.000", "0"], ["00012.3400", "12.34"], ["-001.010", "-1.01"],
  ])("normalizes %s without changing its value", (input, result) => {
    expect(normalizeMoney(input)).toBe(result);
  });

  it.each(["NaN", "Infinity", "+1", "1e3", "1.", ".1", "--1", "1,000", " ", "9".repeat(129)])(
    "rejects a non-contract decimal %s", input => expect(() => normalizeMoney(input)).toThrow(),
  );

  it.each([
    ["1499.9", "تومان"], ["1499.9", "ریال"], ["1.01", "ریال"], ["-0.01", "ریال"],
    ["0", "تومان"], ["-999999999999999.99", "ریال"], ["9007199254740993.01", "تومان"],
  ])("round-trips the exact formatted %s in %s", (value, unit) => {
    expect(parseMoneyInput(formatMoney(value, unit), unit)).toBe(value);
  });

  it.each([
    ["١٢٬٣٤٥٫٦", "تومان", "12345.6"], ["۱۲ ۳۴۵.۶", "تومان", "12345.6"],
    ["1,234.5", "ریال", "123.45"], ["-۱٬۲۰۰٫۱", "ریال", "-120.01"],
    ["۱۲،۳۴۵", "تومان", "12345"], ["1.000", "تومان", "1"],
  ])("parses supported digits and separators in %s", (raw, unit, result) => {
    expect(parseMoneyInput(raw, unit)).toBe(result);
  });

  it.each(["1,23", "12 34", "1/2", "1_000", "1.2.3", "1,000,00", "0.01", "−1"])(
    "does not turn an invalid or overprecise rial draft %s into another amount", raw => {
      expect(parseMoneyInput(raw, "ریال")).toBeNull();
    },
  );

  it("adds and cancels fractions without drifting, truncating or losing signs", () => {
    let amount = "9007199254740993.01";
    for (let index = 0; index < 1000; index++) amount = addMoney(amount, "0.01", "0.1");
    for (let index = 0; index < 1000; index++) amount = subtractMoney(amount, "0.11");
    expect(amount).toBe("9007199254740993.01");
    expect(addMoney()).toBe("0");
    expect(subtractMoney("-0.1", "0.01")).toBe("-0.11");
    expect(negateMoney("-0.11")).toBe("0.11");
    expect(absMoney("-9007199254740993.01")).toBe("9007199254740993.01");
    expect(multiplyMoney("999999999999999.9", "10")).toBe("9999999999999999");
    expect(multiplyMoney("0.1", "0.1")).toBe("0.01");
    expect(multiplyMoney("-1.01", "-10")).toBe("10.1");
    expect(compareMoney("1", "1.000")).toBe(0);
    expect(compareMoney("-9007199254740993.01", "-9007199254740993")).toBe(-1);
  });

  it("validates destination limits without quantizing a request", () => {
    const opening = { scale: 1, min: "0", max: "999999999999999" };
    expect(moneyFits("1499.9", opening)).toBe(true);
    for (const value of ["1499.91", "-0.1", "999999999999999.1", "NaN"]) expect(moneyFits(value, opening)).toBe(false);
    const transaction = { scale: 2, min: "0.01", max: "999999999999" };
    expect(moneyFits("0.01000", transaction)).toBe(true);
    for (const value of ["0", "0.001", "999999999999.01"]) expect(moneyFits(value, transaction)).toBe(false);
  });
});
