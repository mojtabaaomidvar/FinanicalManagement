/* گزارش‌ها — انواع خروجی محاسبات */

import type { Category } from "../category/category.catalog";

export interface MonthTotals {
  income: number;
  expense: number;
}

export interface CategorySlice extends Category {
  value: number;
}

export interface DailyExpense {
  /** روز ماه جلالی */
  day: number;
  value: number;
}

export interface SixMonthSeries {
  labels: string[];
  income: number[];
  expense: number[];
}

export interface WeekFlow {
  /** حرف روز هفته (۷ روز، قدیمی → جدید) */
  labels: string[];
  income: number[];
  expense: number[];
  totalIn: number;
  totalOut: number;
  net: number;
}

/** بازه نمودار ثروت */
export type WealthRange = "7d" | "1m" | "1y" | "max";

export interface WealthPoint {
  /** تاریخ جلالی ISO برای تولتیپ */
  date: string;
  value: number;
}

/** موجودی یک حساب در پایان هر روز (مجموع تراکنش‌های تا آن روز) */
export interface AccountBalance {
  account: import("../account/account.types").Account;
  balance: number;
}

export interface DashboardSummary {
  balance: number;
  month: MonthTotals;
  monthCategorySlices: CategorySlice[];
  recent: import("../transaction/transaction.types").Transaction[];
}
