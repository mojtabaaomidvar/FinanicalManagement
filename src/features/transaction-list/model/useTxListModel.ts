/* مدل لیست تراکنش‌ها — فیلتر، جستجو، گروه‌بندی روزانه */

import { useMemo, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Member } from "@/domain/family/family.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { visibleTransactions, transactionFeeAmount, transactionExpenseAmount } from "@/domain/transaction/transaction.presentation";
import { searchTransactions } from "@/domain/report/report.rules";
import type { CategoryResolver } from "@/domain/category/resolve";
import type { Subcategory } from "@/domain/category/subcategory.types";
import { isoToJalali, formatISO, formatWeekday, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";

export type TxFilter = "all" | "expense" | "income" | "transfer";

/** بازه زمانی فیلتر */
export type TxRange = "all" | "month" | "3m";

export interface TxAdvFilter {
  range: TxRange;
  accountId: string;
  categoryId: string;
  hasTransferFee?: boolean;
}

export interface DayGroup {
  key: string;
  weekday: string;
  iso: string;
  income: number;
  expense: number;
  items: Transaction[];
}

const RANGES: Record<TxRange, string> = {
  all: "همه",
  month: "این ماه",
  "3m": "۳ ماه اخیر",
};

export function useTxListModel(
  txs: Transaction[],
  members: Member[],
  resolve: CategoryResolver,
  initialSearch = "",
  currency = "تومان",
  subcategories: Subcategory[] = [],
) {
  const [filter, setFilter] = useState<TxFilter>("all");
  const [search, setSearch] = useState(initialSearch);
  const [adv, setAdv] = useState<TxAdvFilter>({
    range: "all",
    accountId: "",
    categoryId: "",
  });

  const memberNameOf = useMemo(
    () =>
      (id: string): string =>
        members.find((m) => m.id === id)?.name ?? "—",
    [members],
  );
  const subcategoryNameOf = useMemo(() => {
    const names = new Map(subcategories.map(subcategory => [subcategory.id, subcategory.name]));
    return (transaction: Transaction) => transaction.subcategoryId ? names.get(transaction.subcategoryId) ?? "" : "";
  }, [subcategories]);

  const list = useMemo(() => {
    let l = sortTxDesc(visibleTransactions(txs));
    if (filter !== "all") l = l.filter((t) => t.type === filter);
    if (adv.accountId) {
      l = l.filter(
        (t) => t.accountId === adv.accountId || t.toAccountId === adv.accountId,
      );
    }
    if (adv.categoryId) l = l.filter((t) => t.category === adv.categoryId);
    if (adv.hasTransferFee) l = l.filter(t => transactionFeeAmount(t) > 0 && (!adv.accountId || t.accountId === adv.accountId));
    if (adv.range !== "all") {
      const [ty, tm] = today();
      if (adv.range === "month") {
        l = l.filter((t) => {
          const [y, m] = isoToJalali(t.date);
          return y === ty && m === tm;
        });
      } else {
        /* ۳ ماه جلالی اخیر (شامل ماه جاری) */
        l = l.filter((t) => {
          const [y, m] = isoToJalali(t.date);
          const diff = (ty - y) * 12 + (tm - m);
          return diff >= 0 && diff < 3;
        });
      }
    }
    if (search.trim()) l = searchTransactions(l, search, memberNameOf, resolve, t => toDisplay(t.amount, currency), subcategoryNameOf);
    return l;
  }, [txs, filter, search, adv, memberNameOf, resolve, currency, subcategoryNameOf]);

  /* برچسب خلاصه فیلترهای فعال */
  const advLabel = useMemo(() => {
    const parts: string[] = [];
    if (adv.range !== "all") parts.push(RANGES[adv.range]);
    if (adv.accountId) parts.push("حساب مشخص");
    if (adv.categoryId) parts.push("دسته مشخص");
    if (adv.hasTransferFee) parts.push("دارای کارمزد انتقال");
    return parts.join(" · ");
  }, [adv]);

  const advActive = adv.range !== "all" || !!adv.accountId || !!adv.categoryId || !!adv.hasTransferFee;
  const totalTransferFees = useMemo(() => list.reduce((sum, tx) => sum +
    (!adv.accountId || tx.accountId === adv.accountId ? transactionFeeAmount(tx) : 0), 0), [list, adv.accountId]);

  /* گروه‌بندی بر اساس تاریخ */
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of list) {
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date)!.push(t);
    }
    return [...map.entries()].map(([key, items]) => {
      const jd = isoToJalali(key);
      return {
        key,
        iso: formatISO(jd),
        weekday: formatWeekday(jd),
        income: items.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0),
        expense: items.reduce((s, t) => s + transactionExpenseAmount(t, adv.accountId), 0),
        items,
      };
    });
  }, [list, adv.accountId]);

  return {
    filter,
    setFilter,
    search,
    setSearch,
    adv,
    setAdv,
    advLabel,
    advActive,
    list,
    totalTransferFees,
    groups,
    memberNameOf,
    amountText: formatAmount,
  };
}
