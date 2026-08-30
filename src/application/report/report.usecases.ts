/* Use-caseهای گزارش و داشبورد — محاسبات مالی روی داده مخزن */

import type { TransactionRepository } from "@/domain/transaction/transaction.repository";
import type { Transaction } from "@/domain/transaction/transaction.types";
import {
  categoryBreakdown,
  dailyExpenses,
  monthTotals,
  recentTransactions,
  sixMonthSeries,
  totalBalance,
} from "@/domain/report/report.rules";
import { txsInJalaliMonth } from "@/domain/transaction/transaction.rules";
import type {
  CategorySlice,
  DailyExpense,
  MonthTotals,
  SixMonthSeries,
} from "@/domain/report/report.types";
import { today } from "@/shared/lib/jalali";

export class GetDashboardUseCase {
  constructor(private readonly repo: TransactionRepository) {}

  async execute(all?: Transaction[]): Promise<{
    balance: number;
    month: MonthTotals;
    monthCategorySlices: CategorySlice[];
    recent: Transaction[];
  }> {
    const list = all ?? (await this.repo.list());
    const [jy, jm] = today();
    const mtx = txsInJalaliMonth(list, jy, jm);
    return {
      balance: totalBalance(list),
      month: monthTotals(mtx),
      monthCategorySlices: categoryBreakdown(mtx),
      recent: recentTransactions(list, 5),
    };
  }
}

export class GetMonthlyReportUseCase {
  constructor(private readonly repo: TransactionRepository) {}

  async execute(
    jy: number,
    jm: number,
    all?: Transaction[],
  ): Promise<{
    month: MonthTotals;
    daily: DailyExpense[];
    series: SixMonthSeries;
    categories: CategorySlice[];
  }> {
    const list = all ?? (await this.repo.list());
    const mtx = txsInJalaliMonth(list, jy, jm);
    return {
      month: monthTotals(mtx),
      daily: dailyExpenses(mtx),
      series: sixMonthSeries((y, m) => txsInJalaliMonth(list, y, m), jy, jm),
      categories: categoryBreakdown(mtx),
    };
  }
}
