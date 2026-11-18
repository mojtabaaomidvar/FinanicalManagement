/* قوانین گزارش — همه محاسبات مالی خالص (بدون UI، بدون I/O) */

import { categoryById } from "../category/category.catalog";
import type { CategoryResolver } from "../category/resolve";
import { sortTxDesc } from "../transaction/transaction.rules";
import type { Transaction } from "../transaction/transaction.types";
import type { Account } from "../account/account.types";
import {
  isoToJalali,
  prevMonth,
  MONTHS,
  formatISO,
  addDays,
  shortWeekday,
  jalaliToIso,
  cmp,
  type JDate,
} from "@/shared/lib/jalali";
import { toEn } from "@/shared/lib/digits";
import type {
  CategorySlice,
  DailyExpense,
  MonthTotals,
  SixMonthSeries,
  WeekFlow,
} from "./report.types";

/* جمع مبالغ یک نوع (درآمد/هزینه) */
export function sumByType(
  list: Transaction[],
  type: Transaction["type"],
): number {
  return list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
}

/* موجودی کل = جمع درآمد − جمع هزینه (انتقال جابه‌جایی است، نه تغییر دارایی) */
export function totalBalance(list: Transaction[]): number {
  return list.reduce((s, t) => {
    if (t.type === "income") return s + t.amount;
    if (t.type === "expense") return s - t.amount;
    return s;
  }, 0);
}

/* جمع ماه: درآمد + هزینه */
export function monthTotals(list: Transaction[]): MonthTotals {
  return {
    income: sumByType(list, "income"),
    expense: sumByType(list, "expense"),
  };
}

/* درصد تغییر نسبت به بازه قبل — مبنای صفر قابل مقایسه نیست (null)
   گرد کردن روی «اندازه» انجام می‌شود تا کاهش و افزایش هم‌اندازه، عدد یکسان بدهند
   (Math.round(-62.5) در جاوااسکریپت −۶۲ می‌شود، نه −۶۳) */
export function deltaPercent(current: number, previous: number): number | null {
  if (!previous) return null;
  const raw = ((current - previous) / previous) * 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
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
export function recentTransactions(
  list: Transaction[],
  n: number,
): Transaction[] {
  return sortTxDesc(list).slice(0, n);
}

/* جریان نقدی ۷ روز منتهی به end (روز آخر = end) — قدیمی → جدید */
export function weekFlow(list: Transaction[], end: JDate): WeekFlow {
  const idxOf = new Map<string, number>();
  const labels: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(end, -i);
    idxOf.set(jalaliToIso(d), 6 - i);
    labels.push(shortWeekday(d));
  }
  const income = new Array<number>(7).fill(0);
  const expense = new Array<number>(7).fill(0);
  for (const t of list) {
    const idx = idxOf.get(t.date);
    if (idx === undefined) continue;
    if (t.type === "income") income[idx] += t.amount;
    else if (t.type === "expense") expense[idx] += t.amount;
  }
  const totalIn = income.reduce((s, v) => s + v, 0);
  const totalOut = expense.reduce((s, v) => s + v, 0);
  return {
    labels,
    income,
    expense,
    totalIn,
    totalOut,
    net: totalIn - totalOut,
  };
}

/* موجودی هر حساب = موجودی اولیه + درآمد مستقیم − هزینه مستقیم + ورودی انتقال − خروجی انتقال */
export function accountBalances(
  list: Transaction[],
  accounts: import("../account/account.types").Account[],
): import("./report.types").AccountBalance[] {
  const map = new Map<string, number>(
    accounts.map((a) => [a.id, a.initialBalance ?? 0]),
  );
  for (const t of list) {
    if (t.accountId && map.has(t.accountId)) {
      const cur = map.get(t.accountId)!;
      if (t.type === "income") map.set(t.accountId, cur + t.amount);
      else if (t.type === "expense" || t.type === "transfer")
        map.set(t.accountId, cur - t.amount);
    }
    if (t.type === "transfer" && t.toAccountId && map.has(t.toAccountId)) {
      const cur = map.get(t.toAccountId)!;
      map.set(t.toAccountId, cur + t.amount);
    }
  }
  return accounts.map((a) => ({ account: a, balance: map.get(a.id) ?? 0 }));
}

/** Cash held in known accounts; unassigned transactions and market assets are separate. */
export function totalCashBalance(
  list: Transaction[],
  accounts: import("../account/account.types").Account[],
): number {
  return accountBalances(list, accounts).reduce((sum, row) => sum + row.balance, 0);
}

/* سری تجمعی روزانه؛ با accounts فقط اثر تراکنش روی حساب‌های موجود محاسبه می‌شود. */
export function wealthSeries(
  list: Transaction[],
  range: import("./report.types").WealthRange,
  end: JDate,
  initial = 0,
  accounts?: Account[],
): import("./report.types").WealthPoint[] {
  /* مرتب‌سازی صعودی بر اساس تاریخ */
  const sorted = [...list].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  /* طول بازه به روز */
  let days: number;
  if (range === "7d") days = 7;
  else if (range === "1m") days = 30;
  else if (range === "1y") days = 365;
  else {
    /* حداکثر: از اولین تراکنش تا امروز (حداقل ۷ نقطه) */
    const first = sorted.length ? isoToJalali(sorted[0].date) : end;
    days = Math.max(7, 0);
    let cur = first;
    while (cmp(cur, end) < 0 && days < 3650) {
      cur = addDays(cur, 1);
      days++;
    }
  }
  return wealthSeriesDays(sorted, days, end, initial, accounts);
}

/* سری دارایی در بازه دلخواه — از تاریخ «from» تا تاریخ «to» (شامل هر دو) */
export function wealthSeriesBetween(
  list: Transaction[],
  from: JDate,
  to: JDate,
  initial = 0,
  accounts?: Account[],
): import("./report.types").WealthPoint[] {
  const sorted = [...list].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  let days = 1;
  let cur = from;
  while (cmp(cur, to) < 0 && days < 3650) {
    cur = addDays(cur, 1);
    days++;
  }
  return wealthSeriesDays(sorted, days, to, initial, accounts);
}

/* نقاط تجمعی روزانه — مشترک بین بازه‌های آماده و دلخواه */
function wealthSeriesDays(
  sorted: Transaction[],
  days: number,
  end: JDate,
  initial: number,
  accounts?: Account[],
): import("./report.types").WealthPoint[] {
  const points: import("./report.types").WealthPoint[] = [];
  const accountIds = accounts ? new Set(accounts.map(account => account.id)) : null;
  let idx = 0;
  let wealth = initial;
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(end, -i);
    const iso = jalaliToIso(d);
    while (idx < sorted.length && sorted[idx].date <= iso) {
      const t = sorted[idx];
      if (!accountIds || (t.accountId && accountIds.has(t.accountId))) {
        if (t.type === "income") wealth += t.amount;
        else if (t.type === "expense" || (accountIds && t.type === "transfer")) wealth -= t.amount;
      }
      if (accountIds && t.type === "transfer" && t.toAccountId && accountIds.has(t.toAccountId)) wealth += t.amount;
      idx++;
    }
    points.push({ date: iso, value: wealth });
  }
  return points;
}

/* سهم اعضا از هزینه‌های یک ماه — نزولی */
export function memberExpenseShare(
  list: Transaction[],
): { memberId: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const t of list) {
    if (t.type !== "expense") continue;
    map.set(t.memberId, (map.get(t.memberId) ?? 0) + t.amount);
  }
  return [...map.entries()]
    .map(([memberId, amount]) => ({ memberId, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/* جستجو: یادداشت، دسته، نام عضو، مبلغ، تاریخ جلالی */
function normalizeTransactionSearch(value: string): string {
  return toEn(value.normalize("NFKC"))
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/٫/g, ".")
    .replace(/(?<=\d)[,٬،](?=\d)/g, "")
    .replace(/[\s\u200c]+/g, " ")
    .trim()
    .toLowerCase();
}

export function searchTransactions(
  list: Transaction[],
  query: string,
  memberNameOf: (memberId: string) => string,
  resolve: CategoryResolver = categoryById,
  amountOf: (transaction: Transaction) => number = transaction => transaction.amount,
  labelOf: (transaction: Transaction) => string = () => "",
): Transaction[] {
  const q = normalizeTransactionSearch(query);
  if (!q) return list;
  return list.filter((t) => {
    const cat = resolve(t.category).name;
    const hay =
      (t.note ?? "") +
      " " +
      cat +
      " " +
      labelOf(t) +
      " " +
      memberNameOf(t.memberId) +
      " " +
      amountOf(t).toLocaleString("en-US", { maximumSignificantDigits: 21 }) +
      " " +
      formatISO(isoToJalali(t.date));
    return normalizeTransactionSearch(hay).includes(q);
  });
}
