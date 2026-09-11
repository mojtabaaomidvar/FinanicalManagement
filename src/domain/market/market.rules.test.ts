import { describe, expect, it } from "vitest";
import {
  changeTone,
  findDollar,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  toHemat,
} from "./market.rules";
import type { MarketItem } from "./market.types";

const item = (name: string, over: Partial<MarketItem> = {}): MarketItem => ({
  symbol: "X",
  name,
  price: 0,
  changeValue: 0,
  changePercent: 0,
  unit: "تومان",
  date: "",
  time: "",
  ...over,
});

describe("changeTone", () => {
  it("مثبت/منفی/صفر", () => {
    expect(changeTone(0.5)).toBe("up");
    expect(changeTone(-0.5)).toBe("down");
    expect(changeTone(0)).toBe("flat");
  });
});

describe("formatSigned", () => {
  it("علامت + جداکننده هزارگان فارسی", () => {
    expect(formatSigned(6964959)).toBe("+۶,۹۶۴,۹۵۹");
    expect(formatSigned(-7000)).toBe("−۷,۰۰۰");
    expect(formatSigned(0)).toBe("۰");
  });
});

describe("formatSignedPercent", () => {
  it("دو رقم اعشار و علامت", () => {
    expect(formatSignedPercent(0.82)).toBe("+۰٫۸۲٪");
    expect(formatSignedPercent(-1.18)).toBe("−۱٫۱۸٪");
  });

  it("صفرِ انتهایی حذف می‌شود", () => {
    expect(formatSignedPercent(7.1)).toBe("+۷٫۱٪");
  });
});

describe("toHemat", () => {
  it("ریال TSETMC → همت", () => {
    expect(toHemat(134_757_329_520_715)).toBeCloseTo(13.48, 1);
    expect(toHemat(0)).toBe(0);
  });
});

describe("formatCompact", () => {
  it("میلیارد/میلیون/هزار", () => {
    expect(formatCompact(16_326_463_426)).toBe("۱۶٫۳ میلیارد");
    expect(formatCompact(2_500_000)).toBe("۲٫۵ میلیون");
    expect(formatCompact(4_939)).toBe("۴٫۹ هزار");
    expect(formatCompact(958)).toBe("۹۵۸");
  });
});

describe("findDollar", () => {
  it("«دلار آمریکا» را می‌یابد", () => {
    const list = [item("یورو"), item("دلار آمریکا"), item("درهم امارات")];
    expect(findDollar(list)?.name).toBe("دلار آمریکا");
  });

  it("بدونِ «دلار آمریکا»، اولین نامِ شاملِ «دلار»", () => {
    const list = [item("یورو"), item("دلار استرالیا")];
    expect(findDollar(list)?.name).toBe("دلار استرالیا");
  });

  it("نبودِ دلار → null", () => {
    expect(findDollar([item("یورو")])).toBeNull();
    expect(findDollar([])).toBeNull();
  });
});
