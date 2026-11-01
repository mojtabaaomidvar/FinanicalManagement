import { describe, expect, it } from "vitest";
import {
  checkedOf,
  formatQty,
  isLow,
  liveFormatQty,
  parseQty,
  queuedInventoryIds,
  roundQty,
  summarize,
  sumPrice,
  totalPending,
} from "./shopping.rules";
import type {
  InventoryItem,
  ShoppingItem,
  ShoppingList,
} from "./shopping.types";

function stock(partial: Partial<InventoryItem>): InventoryItem {
  return {
    id: Math.random().toString(36).slice(2),
    title: "شیر",
    unit: null,
    quantity: 0,
    threshold: 0,
    note: null,
    createdBy: null,
    createdAt: "2026-10-12T10:00:00Z",
    updatedAt: "2026-10-12T10:00:00Z",
    ...partial,
  };
}

function item(partial: Partial<ShoppingItem>): ShoppingItem {
  return {
    id: Math.random().toString(36).slice(2),
    listId: "l1",
    title: "نان",
    qty: 1,
    unit: null,
    price: null,
    checked: false,
    boughtAt: null,
    boughtByMemberId: null,
    transactionId: null,
    inventoryItemId: null,
    note: null,
    createdBy: null,
    createdAt: "2026-10-12T10:00:00Z",
    ...partial,
  };
}

function list(items: ShoppingItem[], id = "l1"): ShoppingList {
  return {
    id,
    title: "سوپرمارکت",
    createdBy: null,
    createdAt: "2026-10-12T10:00:00Z",
    items,
  };
}

/* آستانهٔ صفر «بی‌آستانه» است، نه «همیشه کم». این تلهٔ اصلیِ ماژول است:
   اگر صفر را مثلِ بقیهٔ اعداد حساب کنیم، هر قلمِ تازه‌ای که کاربر آستانه‌اش
   را نگذاشته بی‌درنگ اعلان می‌دهد و مرکزِ اعلان بی‌مصرف می‌شود. همین قاعده
   در backend/app/services/inventory.py::is_low هم هست. */
describe("isLow — معنیِ آستانهٔ صفر", () => {
  it("آستانهٔ صفر و موجودیِ صفر → کم نیست", () => {
    expect(isLow(stock({ quantity: 0, threshold: 0 }))).toBe(false);
  });

  it("موجودی برابرِ آستانه → کم است (مرزِ شامل)", () => {
    expect(isLow(stock({ quantity: 2, threshold: 2 }))).toBe(true);
  });

  it("یک واحد بالاتر از آستانه → کم نیست", () => {
    expect(isLow(stock({ quantity: 3, threshold: 2 }))).toBe(false);
  });

  it("کسری هم درست مقایسه می‌شود", () => {
    expect(isLow(stock({ quantity: 1.5, threshold: 2 }))).toBe(true);
    expect(isLow(stock({ quantity: 2.5, threshold: 2 }))).toBe(false);
  });
});

describe("sumPrice — قیمتِ نگفته صفر است، نه حذف", () => {
  it("فهرستِ خالی → صفر", () => {
    expect(sumPrice([])).toBe(0);
  });

  it("بی‌قیمت‌ها جمع را نمی‌شکنند (NaN نمی‌دهد)", () => {
    const total = sumPrice([
      item({ price: 50_000 }),
      item({ price: null }),
      item({ price: 20_000 }),
    ]);
    expect(total).toBe(70_000);
  });
});

describe("summarize", () => {
  it("تیک‌خورده‌ها و قیمت‌های جاافتاده را جدا می‌شمارد", () => {
    const s = summarize(
      list([
        item({ checked: true, price: 50_000 }),
        item({ checked: true, price: null }),
        item({ checked: false, price: 99_000 }),
      ]),
    );
    expect(s.pending).toBe(3);
    expect(s.checked).toBe(2);
    /* قیمتِ قلمِ تیک‌نخورده در جمعِ سبد نمی‌آید — سبد یعنی «آن‌چه برداشتم» */
    expect(s.checkedTotal).toBe(50_000);
    expect(s.missingPrice).toBe(1);
  });

  it("لیستِ خالی همه‌چیز را صفر می‌دهد", () => {
    const s = summarize(list([]));
    expect(s).toEqual({
      pending: 0,
      checked: 0,
      checkedTotal: 0,
      missingPrice: 0,
    });
  });
});

describe("checkedOf / totalPending", () => {
  it("فقط تیک‌خورده‌ها", () => {
    const l = list([item({ checked: true }), item({ checked: false })]);
    expect(checkedOf(l)).toHaveLength(1);
  });

  it("جمعِ اقلامِ همهٔ لیست‌ها", () => {
    expect(
      totalPending([
        list([item({}), item({})], "a"),
        list([item({})], "b"),
        list([], "c"),
      ]),
    ).toBe(3);
  });
});

/* این مجموعه همان چیزی است که اعلانِ انبار را خودپاک‌کن می‌کند: قلمی که
   از قبل در لیست منتظر است نباید دوباره خبر بدهد. */
describe("queuedInventoryIds", () => {
  it("فقط اقلامِ پیوندخورده را برمی‌دارد", () => {
    const ids = queuedInventoryIds([
      list([item({ inventoryItemId: "inv-1" }), item({})], "a"),
      list([item({ inventoryItemId: "inv-2" })], "b"),
    ]);
    expect(ids.has("inv-1")).toBe(true);
    expect(ids.has("inv-2")).toBe(true);
    expect(ids.size).toBe(2);
  });

  it("بی‌لیست → مجموعهٔ خالی", () => {
    expect(queuedInventoryIds([]).size).toBe(0);
  });
});

/* تعداد دو رقمِ اعشار دارد (Numeric(10,2)). سه موردِ اولِ این بخش باگ‌های
   واقعیِ نسخهٔ اولِ همین توابع‌اند که با اجرا پیدا شدند — پس این تست‌ها
   تزئینی نیستند، قفلِ رگرسیون‌اند. */
describe("parseQty / roundQty / formatQty", () => {
  it("جداکنندهٔ اعشارِ فارسی ٫ شناخته می‌شود (وگرنه «۱٫۵» → ۱۵)", () => {
    expect(parseQty("۱٫۵")).toBe(1.5);
    expect(parseQty("۲")).toBe(2);
  });

  it("منفی رد می‌شود — هر دو شکلِ علامت", () => {
    expect(parseQty("-5")).toBe(0);
    /* U+2212؛ صفحه‌کلیدهای فارسی این را تولید می‌کنند */
    expect(parseQty("−5")).toBe(0);
  });

  it("گردکردن با سرور می‌خواند (۱٫۰۰۵ → ۱٫۰۱، نه ۱)", () => {
    expect(roundQty(1.005)).toBe(1.01);
    expect(parseQty("1.239")).toBe(1.24);
  });

  it("جداکنندهٔ هزار اعشار شمرده نمی‌شود", () => {
    expect(parseQty("۱٬۲۰۰")).toBe(1200);
    expect(parseQty("1,200")).toBe(1200);
  });

  it("خالی و نامعتبر → صفر، نه NaN", () => {
    expect(parseQty("")).toBe(0);
    expect(parseQty("٫")).toBe(0);
    expect(parseQty("abc")).toBe(0);
  });

  it("چند جداکننده → فقط اولی اعشار است", () => {
    expect(parseQty("1.2.3")).toBe(1.23);
  });

  it("نمایش صفرِ انتهایی ندارد", () => {
    expect(formatQty(2)).toBe("۲");
    expect(formatQty(1.5)).toBe("۱٫۵");
    expect(formatQty(1.05)).toBe("۱٫۰۵");
  });
});

/* «۲٫» وسطِ تایپ نباید حذف شود، وگرنه کاربر هیچ‌وقت نمی‌تواند اعشار وارد
   کند — همان باگی که در ورودیِ مقدارِ دارایی هم یک‌بار دیده شد. */
describe("liveFormatQty", () => {
  it("جداکنندهٔ نیمه‌تایپ‌شده می‌ماند", () => {
    expect(liveFormatQty("2.")).toBe("۲٫");
  });

  it("بیش از دو رقمِ اعشار بریده می‌شود", () => {
    expect(liveFormatQty("1.2345")).toBe("۱٫۲۳");
  });

  it("صفرِ ابتدایی حذف می‌شود ولی تنها صفر می‌ماند", () => {
    expect(liveFormatQty("007")).toBe("۷");
    expect(liveFormatQty("0")).toBe("۰");
  });

  it("خالی خالی می‌ماند (پاک‌کردنِ کاملِ فیلد ممکن باشد)", () => {
    expect(liveFormatQty("")).toBe("");
  });
});
