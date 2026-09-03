/* مدل لیست تراکنش‌ها — فیلتر، جستجو، گروه‌بندی روزانه */

import { useMemo, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Member } from "@/domain/family/family.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { searchTransactions } from "@/domain/report/report.rules";
import type { CategoryResolver } from "@/domain/category/resolve";
import { isoToJalali, formatISO, formatWeekday, today } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";

export type TxFilter = "all" | "expense" | "income" | "transfer";

/** بازه زمانی فیلتر */
export type TxRange = "all" | "month" | "3m";

export interface TxAdvFilter {
  range: TxRange;
  accountId: string;
  categoryId: string;
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

  const list = useMemo(() => {
    let l = sortTxDesc(txs);
    if (filter !== "all") l = l.filter((t) => t.type === filter);
    if (adv.accountId) {
      l = l.filter(
        (t) => t.accountId === adv.accountId || t.toAccountId === adv.accountId,
      );
    }
    if (adv.categoryId) l = l.filter((t) => t.category === adv.categoryId);
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
    if (search.trim()) l = searchTransactions(l, search, memberNameOf, resolve);
    return l;
  }, [txs, filter, search, adv, memberNameOf, resolve]);

  /* برچسب خلاصه فیلترهای فعال */
  const advLabel = useMemo(() => {
    const parts: string[] = [];
    if (adv.range !== "all") parts.push(RANGES[adv.range]);
    if (adv.accountId) parts.push("حساب مشخص");
    if (adv.categoryId) parts.push("دسته مشخص");
    return parts.join(" · ");
  }, [adv]);

  const advActive = adv.range !== "all" || !!adv.accountId || !!adv.categoryId;

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
        expense: items.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
        items,
      };
    });
  }, [list]);

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
    groups,
    memberNameOf,
    amountText: formatAmount,
  };
}
