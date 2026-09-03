/* UI لیست تراکنش‌ها — گروه‌بندی روزانه، فیلتر، جستجو، فیلتر پیشرفته */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useTxListModel, type TxRange } from "../model/useTxListModel";
import { Modal, Segmented } from "@/shared/ui";
import { isoToJalali, formatISO } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { Transaction } from "@/domain/transaction/transaction.types";
import type { TxFormModel } from "@/features/transaction-form";
import { buildCategoryResolver } from "@/domain/category/resolve";
import {
  CATEGORIES,
} from "@/domain/category/category.catalog";

export function TransactionListFeature({
  form,
  initialSearch = "",
  filterSignal = 0,
}: {
  form: TxFormModel;
  initialSearch?: string;
  filterSignal?: number;
}) {
  const {
    txs,
    members,
    family,
    accounts,
    subcategories,
    customCategories,
  } = useApp();
  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );
  const cur = family?.currency ?? "تومان";
  const m = useTxListModel(txs, members, resolve, initialSearch);
  const [filterOpen, setFilterOpen] = useState(false);

  /* سیگنال باز شدن فیلتر از هدر خانه */
  useEffect(() => {
    if (filterSignal > 0) setFilterOpen(true);
  }, [filterSignal]);

  const subNameOf = (id: string | null) =>
    id ? subcategories.find((s) => s.id === id)?.name ?? null : null;

  const accountNameOf = (id: string | null) =>
    id ? accounts.find((a) => a.id === id)?.title ?? null : null;

  return (
    <div className="content">
      <div className="list-toolbar">
        <Segmented
          value={m.filter}
          onChange={m.setFilter}
          options={[
            { value: "all", label: "همه" },
            { value: "expense", label: "هزینه" },
            { value: "income", label: "درآمد" },
            { value: "transfer", label: "انتقال" },
          ]}
        />
        <button
          type="button"
          className={`icon-btn small filter-btn ${m.advActive ? "on" : ""}`}
          aria-label="فیلتر"
          onClick={() => setFilterOpen(true)}
        >
          <svg>
            <use href="#i-filter" />
          </svg>
        </button>
      </div>
      {m.advActive ? (
        <button
          type="button"
          className="adv-filter-chip"
          onClick={() => setFilterOpen(true)}
        >
          <svg>
            <use href="#i-filter" />
          </svg>
          {m.advLabel}
          <b
            className="adv-clear"
            onClick={(e) => {
              e.stopPropagation();
              m.setAdv({ range: "all", accountId: "", categoryId: "" });
            }}
          >
            پاک‌کردن
          </b>
        </button>
      ) : null}

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
                    fromAccountName={accountNameOf(t.accountId)}
                    toAccountName={accountNameOf(t.toAccountId)}
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

      {/* فیلتر پیشرفته: بازه زمانی / حساب / دسته */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="فیلتر تراکنش‌ها">
        <div className="form-grid">
          <div className="form-row full">
            <label className="form-label">بازه زمانی</label>
            <Segmented
              value={m.adv.range}
              onChange={(v) => m.setAdv({ ...m.adv, range: v as TxRange })}
              options={[
                { value: "all", label: "همه" },
                { value: "month", label: "این ماه" },
                { value: "3m", label: "۳ ماه" },
              ]}
            />
          </div>
          <div className="form-row full">
            <label className="form-label">حساب</label>
            <select
              className="select-input"
              value={m.adv.accountId}
              onChange={(e) => m.setAdv({ ...m.adv, accountId: e.target.value })}
            >
              <option value="">همه حساب‌ها</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row full">
            <label className="form-label">دسته‌بندی</label>
            <select
              className="select-input"
              value={m.adv.categoryId}
              onChange={(e) => m.setAdv({ ...m.adv, categoryId: e.target.value })}
            >
              <option value="">همه دسته‌ها</option>
              <optgroup label="هزینه">
                {CATEGORIES.filter((c) => c.type === "expense").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="درآمد">
                {CATEGORIES.filter((c) => c.type === "income").map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="سفارشی">
                {customCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={() => m.setAdv({ range: "all", accountId: "", categoryId: "" })}
          >
            حذف فیلترها
          </button>
          <button className="btn-primary" onClick={() => setFilterOpen(false)}>
            اعمال
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function TxRow({
  tx,
  currency,
  memberName,
  subcategoryName,
  fromAccountName,
  toAccountName,
  resolve,
  onClick,
}: {
  tx: Transaction;
  currency: string;
  memberName: string;
  subcategoryName?: string | null;
  fromAccountName?: string | null;
  toAccountName?: string | null;
  resolve?: ReturnType<typeof buildCategoryResolver>;
  onClick: () => void;
}) {
  const cat = resolve ? resolve(tx.category) : { name: tx.category, icon: "i-more" };
  const sub = subcategoryName ? ` (${subcategoryName})` : "";
  const isTransfer = tx.type === "transfer";

  /* عنوان انتقال: از حساب مبدأ به مقصد */
  const title = isTransfer
    ? tx.note ||
      `انتقال از «${fromAccountName ?? "حساب"}» به «${toAccountName ?? "حساب"}»`
    : tx.note || cat.name + sub;

  const subtitle = isTransfer
    ? `انتقال وجه · ${memberName} · ${formatISO(isoToJalali(tx.date))}${tx.time ? ` · ${toFa(tx.time)}` : ""}`
    : `${cat.name}${sub} · ${memberName} · ${formatISO(isoToJalali(tx.date))}${tx.time ? ` · ${toFa(tx.time)}` : ""}`;

  return (
    <div className="tx-item" onClick={onClick}>
      <div className={`tx-icon ${tx.type}`}>
        <svg>
          <use href={`#${isTransfer ? "i-swap" : cat.icon}`} />
        </svg>
      </div>
      <div className="tx-info">
        <h4>
          {title}
          {tx.photos?.length ? (
            <span className="tx-photo-badge" aria-label="تصاویر پیوست">
              <svg>
                <use href="#i-image" />
              </svg>
              {toFa(tx.photos.length)}
            </span>
          ) : null}
          {tx.repeat && tx.repeat !== "none" ? (
            <span className="tx-repeat-badge" aria-label="تکرارشونده">
              <svg>
                <use href="#i-repeat" />
              </svg>
            </span>
          ) : null}
        </h4>
        <p>{subtitle}</p>
      </div>
      <div className={`tx-amount ${tx.type}`}>
        <b>{formatAmount(toDisplay(tx.amount, currency))}</b>
        <span>{currency || "تومان"}</span>
      </div>
    </div>
  );
}
