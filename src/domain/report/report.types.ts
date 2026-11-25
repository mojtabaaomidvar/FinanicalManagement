/* گزارش‌ها — انواع خروجی محاسبات */

import type { Category } from "../category/category.catalog";
import type { Money } from "@/shared/lib/money";

export interface MonthTotals {
  income: Money;
  expense: Money;
}

export interface CategorySlice extends Category {
  value: Money;
}

export interface DailyExpense {
  /** روز ماه جلالی */
  day: number;
  value: Money;
}

export interface SixMonthSeries {
  labels: string[];
  income: Money[];
  expense: Money[];
}

export interface WeekFlow {
  /** حرف روز هفته (۷ روز، قدیمی → جدید) */
  labels: string[];
  income: Money[];
  expense: Money[];
  totalIn: Money;
  totalOut: Money;
  net: Money;
}

/** بازه نمودار دارایی */
export type WealthRange = "7d" | "1m" | "1y" | "max";

export interface WealthPoint {
  /** تاریخ جلالی ISO برای تولتیپ */
  date: string;
  value: Money;
}

/** موجودی یک حساب در پایان هر روز (مجموع تراکنش‌های تا آن روز) */
export interface AccountBalance {
  account: import("../account/account.types").Account;
  balance: Money;
}

export interface DashboardSummary {
  balance: Money;
  month: MonthTotals;
  monthCategorySlices: CategorySlice[];
  recent: import("../transaction/transaction.types").Transaction[];
}
