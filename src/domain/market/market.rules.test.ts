import { describe, expect, it } from "vitest";
import {
  changeTone,
  findDollar,
  formatCompact,
  formatSigned,
  formatSignedPercent,
  toHemat,
  toToman,
  usdToman,
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

describe("usdToman", () => {
  it("دلارِ تومانی همان عدد است", () => {
    expect(usdToman([item("دلار آمریکا", { price: 90000 })])).toBe(90000);
  });

  it("دلاری که خودش به ریال قیمت خورده، تقسیم بر ۱۰", () => {
    expect(
      usdToman([item("دلار آمریکا", { price: 900000, unit: "ریال" })]),
    ).toBe(90000);
  });

  it("واحدِ خالی = تومان", () => {
    expect(usdToman([item("دلار آمریکا", { price: 90000, unit: "" })])).toBe(90000);
  });

  it("نبودِ دلار یا قیمتِ صفر → ۰", () => {
    expect(usdToman([item("یورو", { price: 95000 })])).toBe(0);
    expect(usdToman([item("دلار آمریکا", { price: 0 })])).toBe(0);
    expect(usdToman([])).toBe(0);
  });
});

describe("toToman", () => {
  it("تومان بی‌تغییر، ریال تقسیم بر ۱۰", () => {
    expect(toToman(5000, "تومان", 0)).toBe(5000);
    expect(toToman(5000, "ریال", 0)).toBe(500);
  });

  it("یایِ عربی در «ريال» هم شناخته می‌شود", () => {
    // بالادست هر دو املا را فرستاده؛ تطبیقِ خام این ردیف را بی‌قیمت می‌کرد
    expect(toToman(5000, "ريال", 0)).toBe(500);
    expect(toToman(5000, " ریال ", 0)).toBe(500);
  });

  it("دلار با نرخِ روز ضرب می‌شود", () => {
    expect(toToman(2, "دلار", 90000)).toBe(180000);
    expect(toToman(2, "USD", 90000)).toBe(180000);
    expect(toToman(2, "$", 90000)).toBe(180000);
  });

  it("دلار بدونِ نرخ → ۰ (نه عددِ غلط)", () => {
    expect(toToman(2, "دلار", 0)).toBe(0);
  });

  it("واحدِ خالی تومان فرض می‌شود", () => {
    expect(toToman(5000, "", 0)).toBe(5000);
  });

  it("واحدِ ناشناخته → ۰", () => {
    // ۰ یعنی «نمی‌دانیم»؛ UI باید به‌جای عدد، «قیمت ندارد» نشان دهد
    expect(toToman(5000, "یورو", 90000)).toBe(0);
  });

  it("قیمتِ صفر/منفی/نامعتبر → ۰", () => {
    expect(toToman(0, "تومان", 0)).toBe(0);
    expect(toToman(-5, "تومان", 0)).toBe(0);
    expect(toToman(Number.NaN, "تومان", 0)).toBe(0);
  });
});
