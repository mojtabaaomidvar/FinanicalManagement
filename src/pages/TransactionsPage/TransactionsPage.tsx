/* صفحه تراکنش‌ها */

import { useEffect } from "react";
import { TransactionListFeature } from "@/features/transaction-list";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { TxFormModel } from "@/features/transaction-form";
import { BuildBackup } from "./BuildBackup";

export function TransactionsPage({
  form,
  initialSearch = "",
  onSearchConsumed,
  filterSignal = 0,
}: {
  form: TxFormModel;
  initialSearch?: string;
  onSearchConsumed?: () => void;
  filterSignal?: number;
}) {
  const { useCases, family, members, txs } = useApp();
  const { show } = useToast();

  /* متن جستجوی ارسالی از خانه فقط یک‌بار مصرف می‌شود */
  useEffect(() => {
    if (initialSearch) onSearchConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="page active">
      <header className="app-header">
        <div className="header-title">
          <h1>تراکنش‌ها</h1>
          <p>مدیریت درآمد، هزینه و انتقال‌ها</p>
        </div>
        <div className="header-actions">
          <button
            className="icon-btn add-btn"
            aria-label="افزودن تراکنش"
            onClick={form.openNew}
          >
            <svg>
              <use href="#i-plus" />
            </svg>
          </button>
          <BuildBackup
            useCases={useCases!}
            family={family}
            members={members}
            txs={txs}
            notify={show}
          />
        </div>
      </header>

      <TransactionListFeature
        form={form}
        initialSearch={initialSearch}
        filterSignal={filterSignal}
      />
    </section>
  );
}
