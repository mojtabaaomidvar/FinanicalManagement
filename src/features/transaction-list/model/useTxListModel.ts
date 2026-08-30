/* مدل لیست تراکنش‌ها — فیلتر، جستجو، گروه‌بندی روزانه */

import { useMemo, useState } from "react";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { Member } from "@/domain/family/family.types";
import { sortTxDesc } from "@/domain/transaction/transaction.rules";
import { searchTransactions } from "@/domain/report/report.rules";
import { isoToJalali, formatISO, formatWeekday } from "@/shared/lib/jalali";
import { formatAmount, formatSigned } from "@/shared/lib/format";

export type TxFilter = "all" | "expense" | "income";

export interface DayGroup {
  key: string;
  weekday: string;
  iso: string;
  income: number;
  expense: number;
  items: Transaction[];
}

export function useTxListModel(txs: Transaction[], members: Member[]) {
  const [filter, setFilter] = useState<TxFilter>("all");
  const [search, setSearch] = useState("");

  const memberNameOf = useMemo(
    () =>
      (id: string): string =>
        members.find((m) => m.id === id)?.name ?? "—",
    [members],
  );

  const list = useMemo(() => {
    let l = sortTxDesc(txs);
    if (filter !== "all") l = l.filter((t) => t.type === filter);
    if (search.trim()) l = searchTransactions(l, search, memberNameOf);
    return l;
  }, [txs, filter, search, memberNameOf]);

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
    list,
    groups,
    memberNameOf,
    amountText: formatAmount,
    signedText: formatSigned,
  };
}
