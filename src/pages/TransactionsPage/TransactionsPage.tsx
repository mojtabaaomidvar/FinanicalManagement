/* صفحه تراکنش‌ها */

import { TransactionListFeature } from "@/features/transaction-list";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import type { TxFormModel } from "@/features/transaction-form";
import { BuildBackup } from "./BuildBackup";

export function TransactionsPage({ form }: { form: TxFormModel }) {
  const { useCases, family, members, txs } = useApp();
  const { show } = useToast();

  return (
    <section className="page">
      <header className="app-header">
        <div className="header-title">
          <h1>تراکنش‌ها</h1>
          <p>مدیریت درآمد و هزینه‌ها</p>
        </div>
        <BuildBackup
          useCases={useCases!}
          family={family}
          members={members}
          txs={txs}
          notify={show}
        />
      </header>

      <TransactionListFeature form={form} />
    </section>
  );
}
