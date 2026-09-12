import { describe, expect, it } from "vitest";
import {
  effectiveSymbol,
  findHolding,
  formatQuantity,
  liveFormatQuantity,
  parseQuantityInput,
  roundQuantity,
  validateHoldingInput,
  validateQuantity,
} from "./holding.rules";
import type { HoldingInput, HoldingKind } from "./holding.types";

const input = (over: Partial<HoldingInput> = {}): HoldingInput => ({
  kind: "gold",
  symbol: "سکه امامی",
  name: "سکه امامی",
  unit: "تومان",
  quantity: 1,
  ...over,
});

describe("parseQuantityInput", () => {
  it("عددِ صحیح و اعشاری", () => {
    expect(parseQuantityInput("2")).toBe(2);
    expect(parseQuantityInput("2.5")).toBe(2.5);
    expect(parseQuantityInput("0.03")).toBe(0.03);
  });

  it("ارقام فارسی + اعشارِ فارسی", () => {
    expect(parseQuantityInput("۲")).toBe(2);
    expect(parseQuantityInput("۲٫۵")).toBe(2.5);
    expect(parseQuantityInput("۰٫۰۳")).toBe(0.03);
  });

  it("جداکنندهٔ هزار حذف می‌شود، نه این‌که اعشار خوانده شود", () => {
    // مهم: ٬ و ، جداکنندهٔ هزارند — اگر اعشار گرفته شوند ۱۲۰۰ به ۱٫۲ تبدیل می‌شد
    expect(parseQuantityInput("1,200")).toBe(1200);
    expect(parseQuantityInput("۱٬۲۰۰")).toBe(1200);
    expect(parseQuantityInput("۱،۲۰۰")).toBe(1200);
  });

  it("ورودیِ خالی/نامعتبر صفر می‌شود، نه NaN", () => {
    expect(parseQuantityInput("")).toBe(0);
    expect(parseQuantityInput("abc")).toBe(0);
    expect(parseQuantityInput(".")).toBe(0);
  });

  it("چند نقطه: فقط اولی اعشار است", () => {
    expect(parseQuantityInput("1.2.3")).toBe(1.23);
  });
});

describe("liveFormatQuantity", () => {
  it("نقطهٔ در حالِ تایپ حفظ می‌شود", () => {
    // اگر «۲٫» حذف شود کاربر اصلاً نمی‌تواند اعشار وارد کند
    expect(liveFormatQuantity("2.")).toBe("۲٫");
    expect(liveFormatQuantity("2.5")).toBe("۲٫۵");
  });

  it("صفرِ ابتدایی پاک می‌شود ولی «۰٫» می‌ماند", () => {
    expect(liveFormatQuantity("007")).toBe("۷");
    expect(liveFormatQuantity("0.03")).toBe("۰٫۰۳");
  });

  it("بیش از شش رقمِ اعشار بریده می‌شود (هم‌سان با ستون)", () => {
    expect(liveFormatQuantity("1.12345678")).toBe("۱٫۱۲۳۴۵۶");
  });
});

describe("formatQuantity", () => {
  it("صفرِ انتهایی نمایش داده نمی‌شود", () => {
    expect(formatQuantity(2)).toBe("۲");
    expect(formatQuantity(2.5)).toBe("۲٫۵");
    expect(formatQuantity(0.03)).toBe("۰٫۰۳");
  });
});

describe("validateQuantity", () => {
  it("مقدارِ معتبر", () => {
    expect(validateQuantity(2.5).ok).toBe(true);
    expect(validateQuantity(0.000001).ok).toBe(true);
  });

  it("صفر و منفی رد می‌شوند", () => {
    expect(validateQuantity(0).error).toBe("ZERO_QUANTITY");
    expect(validateQuantity(-1).error).toBe("ZERO_QUANTITY");
  });

  it("مقداری که به صفر گِرد می‌شود، پیشِ سرور رد می‌شود", () => {
    // وگرنه Postgres گِردش می‌کند و CHECK(quantity > 0) با خطای مبهم می‌ترکد
    expect(validateQuantity(0.0000001).error).toBe("ZERO_QUANTITY");
  });

  it("بزرگ‌تر از ظرفیتِ ستون رد می‌شود", () => {
    expect(validateQuantity(1e13).error).toBe("HUGE_QUANTITY");
  });
});

describe("roundQuantity", () => {
  it("به شش رقمِ اعشار گِرد می‌کند", () => {
    expect(roundQuantity(1.12345678)).toBe(1.123457);
  });
});

describe("validateHoldingInput", () => {
  it("ورودیِ درست", () => {
    expect(validateHoldingInput(input()).ok).toBe(true);
  });

  it("نوعِ ناشناخته", () => {
    expect(
      validateHoldingInput(input({ kind: "bogus" as HoldingInput["kind"] })).error,
    ).toBe("INVALID_KIND");
  });

  it("نامِ خالی یا خیلی بلند", () => {
    expect(validateHoldingInput(input({ name: "  " })).error).toBe("INVALID_NAME");
    expect(validateHoldingInput(input({ name: "x".repeat(81) })).error).toBe(
      "INVALID_NAME",
    );
  });

  it("مقدارِ نامعتبر از همان مسیرِ validateQuantity رد می‌شود", () => {
    expect(validateHoldingInput(input({ quantity: 0 })).error).toBe("ZERO_QUANTITY");
  });
});

/* این دو تابع آینهٔ قاعدهٔ سرورند:
     symbol = (req.symbol or "").strip()[:40] or name
   اگر از هم جدا بیفتند، کاربر روی نمادی که قبلاً دارد می‌زند و به‌جای
   ویرایش، ردیفِ تکراری ساخته می‌شود. */
describe("effectiveSymbol", () => {
  it("نمادِ موجود، فقط trim می‌شود", () => {
    expect(effectiveSymbol("  IRO1FOLD0001 ", "فولاد مبارکه")).toBe("IRO1FOLD0001");
  });

  it("نمادِ خالی → نام جایش را می‌گیرد", () => {
    // ردیف‌های طلا/سکه در بالادست اغلب نماد ندارند
    expect(effectiveSymbol("", "سکه امامی")).toBe("سکه امامی");
    expect(effectiveSymbol("   ", "سکه امامی")).toBe("سکه امامی");
  });

  it("نمادِ بلندتر از ۴۰ بریده می‌شود — دقیقاً مثلِ سرور", () => {
    expect(effectiveSymbol("x".repeat(50), "نام")).toBe("x".repeat(40));
  });

  it("نامِ بلند در حالتِ جایگزینی بریده نمی‌شود", () => {
    // سرور هم در این شاخه برش ۴۰ را اعمال نمی‌کند (نام تا ۸۰ مجاز است)
    const long = "ن".repeat(60);
    expect(effectiveSymbol("", long)).toBe(long);
  });

  it("هر دو خالی → رشتهٔ خالی", () => {
    expect(effectiveSymbol("", "  ")).toBe("");
  });
});

describe("findHolding", () => {
  const row = (kind: HoldingKind, symbol: string) => ({ kind, symbol });
  const items = [
    row("gold", "سکه امامی"),
    row("stock", "فولاد"),
    row("crypto", "BTC"),
  ];

  it("ردیفِ موجود را با نمادِ خام می‌یابد", () => {
    expect(findHolding(items, "stock", "فولاد", "فولاد مبارکه")?.symbol).toBe("فولاد");
  });

  it("نمادِ خالی با نام تطبیق داده می‌شود", () => {
    expect(findHolding(items, "gold", "", "سکه امامی")?.symbol).toBe("سکه امامی");
  });

  it("نوعِ متفاوت تطبیق نمی‌دهد", () => {
    // «فولاد»ِ بورس نباید با دارایی‌ای از نوعِ طلا یکی شمرده شود
    expect(findHolding(items, "gold", "فولاد", "فولاد")).toBeUndefined();
  });

  it("نمادِ ناموجود → undefined (یعنی «تازه است»)", () => {
    expect(findHolding(items, "crypto", "ETH", "اتریوم")).toBeUndefined();
  });

  it("نماد و نامِ خالی → undefined، نه تطبیقِ تصادفی", () => {
    expect(findHolding(items, "gold", "", "")).toBeUndefined();
  });
});
