import { describe, expect, it } from "vitest";
import {
  parseSms,
  detectType,
  extractBalance,
  splitSmsBlocks,
} from "./sms-parser";

describe("sms-parser", () => {
  it("برداشت بانک ملت با مانده و تاریخ جلالی", () => {
    const p = parseSms(
      "بانک ملت؛ برداشت مبلغ ۲۵۰,۰۰۰ ریال؛ مانده حساب ۱۲,۵۰۰,۰۰۰؛ ۱۴۰۴/۰۶/۱۵-۱۴:۳۰",
    );
    expect(p).not.toBeNull();
    expect(p!.type).toBe("expense");
    expect(p!.bank).toBe("بانک ملت");
    expect(p!.amount).toBe(250000);
    expect(p!.balance).toBe(12500000);
    expect(p!.date!.jalali).toEqual([1404, 6, 15]);
  });

  it("واریز حقوق", () => {
    const p = parseSms(
      "بانک سامان: واریز مبلغ 45,000,000 ریال به حساب شما. 2025-08-29",
    );
    expect(p!.type).toBe("income");
    expect(p!.amount).toBe(45000000);
    expect(p!.date!.gy).toBe(2025);
  });

  it("نامشخص بدون کلیدواژه", () => {
    expect(detectType("سلام حال شما")).toBeNull();
  });

  it("استخراج موجودی با الگوی مانده", () => {
    expect(
      extractBalance("مانده حساب شما: 9,800,000 ریال"),
    ).toBe(9800000);
  });

  it("تفکیک چند پیامک با خط خالی", () => {
    const blocks = splitSmsBlocks("پیامک اول\n\nپیامک دوم\n\n\nپیامک سوم");
    expect(blocks).toEqual(["پیامک اول", "پیامک دوم", "پیامک سوم"]);
  });

  it("مبلغ پس از کلیدواژه «مبلغ» بر موجودی مقدم است", () => {
    /* موجودی اول آمده اما مبلغ تراکنش بعد از کلیدواژه «مبلغ» است */
    const p = parseSms(
      "بانک ملی؛ موجودی شما 8,500,000 ریال؛ پرداخت اینترنتی به مبلغ 320,000 ریال انجام شد",
    );
    expect(p!.type).toBe("expense");
    expect(p!.amount).toBe(320000);
    expect(p!.balance).toBe(8500000);
  });

  it("مبلغ همراه جداکننده بدون کلیدواژه", () => {
    const p = parseSms("خرید 1,250,000 تومان از درگاه؛ موجودی 4,000,000");
    expect(p!.amount).toBe(1250000);
    expect(p!.balance).toBe(4000000);
  });
});
