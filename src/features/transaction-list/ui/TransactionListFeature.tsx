import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
/* UI لیست تراکنش‌ها — گروه‌بندی روزانه، فیلتر، جستجو، فیلتر پیشرفته */

import { useEffect, useId, useMemo, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useTxListModel, type TxAdvFilter, type TxRange } from "../model/useTxListModel";
import { Modal, Segmented } from "@/shared/ui";
import { isoToJalali, formatISO } from "@/shared/lib/jalali";
import { formatAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import type { Transaction } from "@/domain/transaction/transaction.types";
import { transactionFeeAmount } from "@/domain/transaction/transaction.presentation";
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
    cur,
    accounts,
    subcategories,
    customCategories,
  } = useApp();
  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );
  const m = useTxListModel(txs, members, resolve, initialSearch, cur, subcategories);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<TxAdvFilter>(m.adv);
  const rangeId = useId();
  const accountId = useId();
  const categoryId = useId();

  function openFilters() {
    setFilterDraft({ ...m.adv });
    setFilterOpen(true);
  }

  function clearView() {
    m.setSearch("");
    m.setFilter("all");
    m.setAdv({ range: "all", accountId: "", categoryId: "" });
  }

  /* سیگنال باز شدن فیلتر از هدر خانه */
  useEffect(() => {
    if (filterSignal > 0) openFilters();
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
          onClick={openFilters}
        >
          <svg>
            <use href="#i-filter" />
          </svg>
        </button>
      </div>
      {m.advActive ? (
        <div className="adv-filter-chip">
          <button type="button" className="adv-filter-edit" onClick={openFilters}>
            <svg aria-hidden="true">
              <use href="#i-filter" />
            </svg>
            {m.advLabel}
          </button>
          <button
            type="button"
            className="adv-clear"
            aria-label="پاک‌کردن فیلترها"
            onClick={() => m.setAdv({ range: "all", accountId: "", categoryId: "" })}
          >
            پاک‌کردن
          </button>
        </div>
      ) : null}

      <div className="search-box">
        <input
          type="search"
          aria-label="جست‌وجو در تراکنش‌ها"
          placeholder="جست‌وجو در تراکنش‌ها…"
          value={m.search}
          onChange={(e) => m.setSearch(e.target.value)}
        />
      </div>

      {m.totalTransferFees > 0 || m.adv.hasTransferFee ? <p className="tx-simple-hint" role="status">
        مجموع کارمزد انتقال: {formatAmount(toDisplay(m.totalTransferFees, cur))} {currencyDisplayLabel(cur)}
      </p> : null}

      {m.groups.length ? (
        <div className="tx-list grouped">
          {m.groups.map((g) => (
            <div key={g.key}>
              <div className="tx-group-title">
                {g.weekday}
                <span className="day-sum">
                  ·{" "}
                  {g.income ? (
                    <span style={{ color: "var(--income)" }}>
                      {formatAmount(toDisplay(g.income, cur))}
                      <span className="cur-tag">{currencyDisplayLabel(cur)}</span>
                    </span>
                  ) : null}
                  {g.income && g.expense ? " · " : ""}
                  {g.expense ? (
                    <span style={{ color: "var(--expense)" }}>
                      {formatAmount(toDisplay(g.expense, cur))}
                      <span className="cur-tag">{currencyDisplayLabel(cur)}</span>
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="tx-list">
                {g.items.map((t) => (
                  <TxRow
                    key={t.id}
                    tx={t}
                    currency={cur}
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
        <div className="empty-state tx-list-empty">
          <div className="empty-icon">
            <svg>
              <use href="#i-receipt" />
            </svg>
          </div>
          {txs.length ? <>
            <p>نتیجه‌ای پیدا نشد</p>
            <button type="button" className="btn-secondary" onClick={clearView}>پاک‌کردن جست‌وجو و فیلترها</button>
          </> : <>
            <p>هنوز تراکنشی ثبت نکرده‌اید</p>
            <button type="button" className="btn-primary" onClick={form.openNew}>ثبت اولین تراکنش</button>
          </>}
        </div>
      )}

      {/* فیلتر پیشرفته: بازه زمانی / حساب / دسته */}
      <Modal open={filterOpen} onClose={() => setFilterOpen(false)} title="فیلتر تراکنش‌ها">
        <div className="form-grid">
          <div className="form-row full">
            <label id={rangeId} className="form-label">بازه زمانی</label>
            <div role="group" aria-labelledby={rangeId}>
              <Segmented
                value={filterDraft.range}
                onChange={(v) => setFilterDraft({ ...filterDraft, range: v as TxRange })}
                options={[
                  { value: "all", label: "همه" },
                  { value: "month", label: "این ماه" },
                  { value: "3m", label: "۳ ماه" },
                ]}
              />
            </div>
          </div>
          <div className="form-row full">
            <label htmlFor={accountId} className="form-label">حساب</label>
            <select
              id={accountId}
              className="select-input"
              value={filterDraft.accountId}
              onChange={(e) => setFilterDraft({ ...filterDraft, accountId: e.target.value })}
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
            <label htmlFor={categoryId} className="form-label">دسته‌بندی</label>
            <select
              id={categoryId}
              className="select-input"
              value={filterDraft.categoryId}
              onChange={(e) => setFilterDraft({ ...filterDraft, categoryId: e.target.value })}
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
          <div className="form-row full">
            <label className="form-label">
              <input type="checkbox" checked={!!filterDraft.hasTransferFee}
                onChange={event => setFilterDraft({ ...filterDraft, hasTransferFee: event.target.checked })} />
              فقط تراکنش‌های دارای کارمزد انتقال
            </label>
          </div>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setFilterDraft({ range: "all", accountId: "", categoryId: "" })}
          >
            حذف فیلترها
          </button>
          <button type="button" className="btn-secondary" onClick={() => setFilterOpen(false)}>
            انصراف
          </button>
          <button type="button" className="btn-primary" onClick={() => {
            m.setAdv({ ...filterDraft });
            setFilterOpen(false);
          }}>
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
  const feeAmount = tx.sourceKind === "transfer_fee" ? 0 : transactionFeeAmount(tx);

  /* عنوان انتقال: از حساب مبدأ به مقصد */
  const title = isTransfer
    ? tx.note ||
      `انتقال از «${fromAccountName ?? "حساب"}» به «${toAccountName ?? "حساب"}»`
    : tx.note || cat.name + sub;

  const subtitle = isTransfer
    ? `انتقال وجه · ${memberName} · ${formatISO(isoToJalali(tx.date))}${tx.time ? ` · ${toFa(tx.time)}` : ""}`
    : `${cat.name}${sub} · ${memberName} · ${formatISO(isoToJalali(tx.date))}${tx.time ? ` · ${toFa(tx.time)}` : ""}`;

  return (
    <div className="tx-item" role="button" tabIndex={0} onClick={onClick} onKeyDown={event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick();
      }
    }}>
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
        {feeAmount > 0 ? <p>
          کارمزد انتقال: {formatAmount(toDisplay(feeAmount, currency))} {currencyDisplayLabel(currency)}
          <br />
          جمع برداشت از حساب: {formatAmount(toDisplay(tx.amount + feeAmount, currency))} {currencyDisplayLabel(currency)}
        </p> : null}
      </div>
      <div className={`tx-amount ${tx.type}`}>
        <b>{formatAmount(toDisplay(tx.amount, currency))}</b>
        <span>{currencyDisplayLabel(currency)}</span>
      </div>
    </div>
  );
}
