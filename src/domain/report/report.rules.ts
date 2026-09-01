/* قوانین گزارش — همه محاسبات مالی خالص (بدون UI، بدون I/O) */

import { categoryById } from "../category/category.catalog";
import type { CategoryResolver } from "../category/resolve";
import { sortTxDesc } from "../transaction/transaction.rules";
import type { Transaction } from "../transaction/transaction.types";
import { isoToJalali, prevMonth, MONTHS, formatISO } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import type {
  CategorySlice,
  DailyExpense,
  MonthTotals,
  SixMonthSeries,
} from "./report.types";

/* جمع مبالغ یک نوع (درآمد/هزینه) */
export function sumByType(list: Transaction[], type: Transaction["type"]): number {
  return list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
}

/* موجودی کل = جمع درآمد − جمع هزینه */
export function totalBalance(list: Transaction[]): number {
  return list.reduce(
    (s, t) => s + (t.type === "income" ? t.amount : -t.amount),
    0,
  );
}

/* جمع ماه: درآمد + هزینه */
export function monthTotals(list: Transaction[]): MonthTotals {
  return { income: sumByType(list, "income"), expense: sumByType(list, "expense") };
}

/* تجزیه هزینه به تفکیک دسته — نزولی بر اساس مبلغ
   resolve اختیاری برای پشتیبانی دسته‌های سفارشی خانواده */
export function categoryBreakdown(
  list: Transaction[],
  resolve: CategoryResolver = categoryById,
): CategorySlice[] {
  const map = new Map<string, number>();
  for (const t of list) {
    if (t.type !== "expense") continue;
    map.set(t.category, (map.get(t.category) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([id, value]) => ({ ...resolve(id), value }))
    .sort((a, b) => b.value - a.value);
}

/* هزینه روزانه یک ماه جلالی — مرتب بر اساس روز */
export function dailyExpenses(list: Transaction[]): DailyExpense[] {
  const map = new Map<number, number>();
  for (const t of list) {
    if (t.type !== "expense") continue;
    const d = isoToJalali(t.date)[2];
    map.set(d, (map.get(d) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => a.day - b.day);
}

/* سری ۶ ماهه (شامل ماه jy/jm و ۵ ماه قبل) — قدیمی → جدید */
export function sixMonthSeries(
  monthsIn: (jy: number, jm: number) => Transaction[],
  jy: number,
  jm: number,
): SixMonthSeries {
  const labels: string[] = [];
  const income: number[] = [];
  const expense: number[] = [];
  let [py, pm] = [jy, jm];
  for (let i = 0; i < 6; i++) {
    const m = monthsIn(py, pm);
    labels.unshift(MONTHS[pm - 1].slice(0, 3));
    income.unshift(sumByType(m, "income"));
    expense.unshift(sumByType(m, "expense"));
    [py, pm] = prevMonth(py, pm);
  }
  return { labels, income, expense };
}

/* n تراکنش اخیر */
export function recentTransactions(list: Transaction[], n: number): Transaction[] {
  return sortTxDesc(list).slice(0, n);
}

/* جستجو: یادداشت، دسته، نام عضو، مبلغ، تاریخ جلالی */
export function searchTransactions(
  list: Transaction[],
  query: string,
  memberNameOf: (memberId: string) => string,
  resolve: CategoryResolver = categoryById,
): Transaction[] {
  const q = query.trim();
  if (!q) return list;
  return list.filter((t) => {
    const cat = resolve(t.category).name;
    const hay =
      (t.note ?? "") +
      " " +
      cat +
      " " +
      memberNameOf(t.memberId) +
      " " +
      formatAmount(t.amount) +
      " " +
      formatISO(isoToJalali(t.date));
    return hay.includes(q);
  });
}
