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

export interface DashboardSummary {
  balance: number;
  month: MonthTotals;
  monthCategorySlices: CategorySlice[];
  recent: import("../transaction/transaction.types").Transaction[];
}
