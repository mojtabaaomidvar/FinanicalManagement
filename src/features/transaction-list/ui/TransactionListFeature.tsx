/* UI لیست تراکنش‌ها — گروه‌بندی روزانه، فیلتر، جستجو */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useTxListModel } from "../model/useTxListModel";
import { Segmented } from "@/shared/ui";
import { isoToJalali, formatISO } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { TxFormModel } from "@/features/transaction-form";
import { buildCategoryResolver } from "@/domain/category/resolve";

export function TransactionListFeature({ form }: { form: TxFormModel }) {
  const { txs, members, family, subcategories, customCategories } = useApp();
  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );
  const cur = family?.currency ?? "تومان";
  const m = useTxListModel(txs, members, resolve);

  const subNameOf = (id: string | null) =>
    id ? subcategories.find((s) => s.id === id)?.name ?? null : null;

  return (
    <div className="content">
      <Segmented
        value={m.filter}
        onChange={m.setFilter}
        options={[
          { value: "all", label: "همه" },
          { value: "expense", label: "هزینه" },
          { value: "income", label: "درآمد" },
        ]}
      />

      <div className="search-box">
        <input
          type="text"
          placeholder="جستجو در تراکنش‌ها..."
          value={m.search}
          onChange={(e) => m.setSearch(e.target.value)}
        />
      </div>

      {m.groups.length ? (
        <div className="tx-list grouped">
          {m.groups.map((g) => (
            <div key={g.key}>
              <div className="tx-group-title">
                {g.weekday}
                <span className="day-sum">
                  ·{" "}
                  {g.income ? (
                    <span style={{ color: "var(--income)" }}>{formatAmount(toDisplay(g.income, cur))}</span>
                  ) : null}
                  {g.income && g.expense ? " · " : ""}
                  {g.expense ? (
                    <span style={{ color: "var(--expense)" }}>{formatAmount(toDisplay(g.expense, cur))}</span>
                  ) : null}
                </span>
              </div>
              <div className="tx-list">
                {g.items.map((t) => (
                  <TxRow
                    key={t.id}
                    tx={t}
                    currency={family?.currency ?? ""}
                    memberName={m.memberNameOf(t.memberId)}
                    subcategoryName={subNameOf(t.subcategoryId)}
                    resolve={resolve}
                    onClick={() => form.openEdit(t)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-icon">
            <svg>
              <use href="#i-receipt" />
            </svg>
          </div>
          <p>تراکنشی یافت نشد</p>
        </div>
      )}
    </div>
  );
}

export function TxRow({
  tx,
  currency,
  memberName,
  subcategoryName,
  resolve,
  onClick,
}: {
  tx: Transaction;
  currency: string;
  memberName: string;
  subcategoryName?: string | null;
  resolve?: ReturnType<typeof buildCategoryResolver>;
  onClick: () => void;
}) {
  const cat = resolve ? resolve(tx.category) : { name: tx.category, icon: "i-more" };
  const sub = subcategoryName ? ` (${subcategoryName})` : "";
  return (
    <div className="tx-item" onClick={onClick}>
      <div className={`tx-icon ${tx.type}`}>
        <svg>
          <use href={`#${cat.icon}`} />
        </svg>
      </div>
      <div className="tx-info">
        <h4>
          {tx.note || cat.name + sub}
          {tx.photos?.length ? (
            <span className="tx-photo-badge" aria-label="تصاویر پیوست">
              <svg>
                <use href="#i-image" />
              </svg>
              {toFa(tx.photos.length)}
            </span>
          ) : null}
        </h4>
        <p>
          {cat.name}
          {sub} · {memberName} · {formatISO(isoToJalali(tx.date))}
          {tx.time ? ` · ${toFa(tx.time)}` : ""}
        </p>
      </div>
      <div className={`tx-amount ${tx.type}`}>
        <b>{formatAmount(toDisplay(tx.amount, currency))}</b>
        <span>{currency || "تومان"}</span>
      </div>
    </div>
  );
}
