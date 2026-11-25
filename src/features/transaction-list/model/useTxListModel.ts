/* مدل لیست تراکنش‌ها — فیلتر، جستجو، گروه‌بندی روزانه */

import { useMemo, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Member } from "@/domain/family/family.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { transactionFeeAmount, transactionExpenseAmount } from "@/domain/transaction/transaction.presentation";
import { searchTransactions } from "@/domain/report/report.rules";
import type { CategoryResolver } from "@/domain/category/resolve";
import type { Subcategory } from "@/domain/category/subcategory.types";
import { isoToJalali, formatISO, formatWeekday } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { addMoney, type Money } from "@/shared/lib/money";

import { filterTransactions, type TxFilter, type TxRange, type TxAdvFilter } from "./transactionFilters";
export type { TxFilter, TxRange, TxAdvFilter } from "./transactionFilters";

export interface DayGroup {
  key: string;
  weekday: string;
  iso: string;
  income: Money;
  expense: Money;
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
  fixedAccountId = "",
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
    let l = sortTxDesc(filterTransactions(txs, filter, adv, fixedAccountId));
    if (search.trim()) l = searchTransactions(l, search, memberNameOf, resolve, t => toDisplay(t.amount, currency), subcategoryNameOf);
    return l;
  }, [txs, filter, search, adv, fixedAccountId, memberNameOf, resolve, currency, subcategoryNameOf]);

  /* برچسب خلاصه فیلترهای فعال */
  const advLabel = useMemo(() => {
    const parts: string[] = [];
    if (adv.range !== "all") parts.push(RANGES[adv.range]);
    if (adv.accountId) parts.push("حساب مشخص");
    if (adv.categoryId) parts.push("دسته مشخص");
    if (adv.hasTransferFee) parts.push("دارای کارمزد انتقال");
    if (adv.fromDate || adv.toDate) parts.push("بازهٔ تاریخ مشخص");
    return parts.join(" · ");
  }, [adv]);

  const accountScope = fixedAccountId || adv.accountId;
  const advActive = adv.range !== "all" || !!adv.accountId || !!adv.categoryId || !!adv.hasTransferFee || !!adv.fromDate || !!adv.toDate;
  const totalTransferFees = useMemo(() => addMoney(...list.map(tx =>
    !accountScope || tx.accountId === accountScope ? transactionFeeAmount(tx) : "0")), [list, accountScope]);

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
        income: addMoney(...items.filter((t) => t.type === "income").map(t => t.amount)),
        expense: addMoney(...items.map(t => transactionExpenseAmount(t, accountScope))),
        items,
      };
    });
  }, [list, accountScope]);

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
