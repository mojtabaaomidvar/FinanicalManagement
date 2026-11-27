/* §۱.۸ — دو انتیتیِ «خرید» و یکی «انبار».

   لیستِ خرید پاسخِ «چه بخریم» است و انبار پاسخِ «چه داریم». یکی‌کردنشان
   یعنی ردیفی که هم‌زمان «نداریمش» و «۲ تا داریم» را بگوید. دلیلِ کامل و
   بقیهٔ تصمیم‌ها در `backend/alembic/versions/0011_shopping.py` مستند است. */

import type { Money } from "@/shared/lib/money";

export interface ShoppingItem {
  id: string;
  listId: string;
  title: string;
  /** می‌تواند کسری باشد (۱٫۵ کیلو) */
  qty: number;
  unit: string | null;
  /** تومان — قیمتِ **کلِ همین سطر**، نه قیمتِ واحد. null یعنی «نگفتم». */
  price: Money | null;
  /** «در سبد است» — هنوز خرجی ثبت نشده */
  checked: boolean;
  /** ISO با T — میلادی. پر بودنش یعنی سفرِ خرید بسته شده. */
  boughtAt: string | null;
  boughtByMemberId: string | null;
  /** تراکنشِ هزینه‌ای که بستنِ سفر ساخت (رابطهٔ Shopping ↕ Finance، §۴.۷) */
  transactionId: string | null;
  /** اگر پر باشد، خریدنِ این قلم موجودیِ آن ردیفِ انبار را بالا می‌برد */
  inventoryItemId: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ShoppingList {
  id: string;
  title: string;
  createdBy: string | null;
  createdAt: string;
  /** فقط اقلامِ **نخریده** — سرور خریده‌شده‌ها را نمی‌فرستد */
  items: ShoppingItem[];
}

export interface ShoppingItemInput {
  title: string;
  qty?: number | null;
  unit?: string | null;
  /** تومان؛ صفر یا خالی یعنی «قیمت نگفتم» */
  price?: Money | null;
  note?: string | null;
  inventoryItemId?: string | null;
}

/** «خرید انجام شد» — همه اختیاری، مثلِ `BillPayInput`. */
export interface TripInput {
  accountId?: string | null;
  /** "YYYY-MM-DD" میلادی */
  date?: string | null;
  /** false یعنی «خرجش را ثبت نکن» (مثلاً کسِ دیگری حساب کرده) */
  createTransaction?: boolean;
}

export interface TripResult {
  /** لیست پس از بستنِ سفر — خریده‌شده‌ها دیگر در آن نیستند */
  list: ShoppingList;
  /** تومان — جمعِ قیمتِ اقلامِ بسته‌شده */
  total: Money;
  itemCount: number;
  /** null یعنی تراکنشی ساخته نشد (جمع صفر بود یا کاربر نخواست) */
  transactionId: string | null;
}

export interface InventoryItem {
  id: string;
  title: string;
  unit: string | null;
  quantity: number;
  /** Stable reviewed-catalog identity used by meal availability checks. */
  catalogId?: string | null;
  /** Stable catalog subgroup; older cached rows may not have a category yet. */
  category?: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryInput {
  title: string;
  unit?: string | null;
  quantity?: number | null;
  category?: string | null;
  note?: string | null;
}

/** واحدهای پیشنهادی. فهرستِ بسته نیست — ستونِ `unit` متنِ آزاد است، چون
 *  خانه‌ها واژهٔ خودشان را دارند و فهرستِ بسته فقط کاربر را دور می‌زد. */
export const UNIT_PRESETS = [
  "عدد",
  "بسته",
  "کیلو",
  "گرم",
  "لیتر",
  "شیشه",
  "قوطی",
  "جعبه",
] as const;
