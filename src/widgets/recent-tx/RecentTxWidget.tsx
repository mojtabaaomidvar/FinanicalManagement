/* ویجت آخرین تراکنش‌ها — سه ردیف اخیر با امکان ویرایش */

import { useMemo } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { Card } from "@/shared/ui";
import { TxRow } from "@/features/transaction-list";
import { recentTransactions } from "@/domain/report/report.rules";
import { buildCategoryResolver } from "@/domain/category/resolve";
import type { TxFormModel } from "@/features/transaction-form";

export function RecentTxWidget({
  form,
  onNavTransactions,
}: {
  form: TxFormModel;
  onNavTransactions: () => void;
}) {
  const { txs, members, family, accounts, subcategories, customCategories } =
    useApp();

  const resolve = useMemo(
    () => buildCategoryResolver(customCategories),
    [customCategories],
  );
  const recent = useMemo(() => recentTransactions(txs, 3), [txs]);
  const accountName = (id: string | null) =>
    id ? accounts.find((a) => a.id === id)?.title ?? null : null;

  return (
    <Card
      title="آخرین تراکنش‌ها"
      action={
        <button className="link-btn" onClick={onNavTransactions}>
          مشاهده همه
        </button>
      }
    >
      <div className="tx-list">
        {recent.length ? (
          recent.map((t) => (
            <TxRow
              key={t.id}
              tx={t}
              currency={family?.currency ?? ""}
              memberName={members.find((x) => x.id === t.memberId)?.name ?? "—"}
              subcategoryName={
                t.subcategoryId
                  ? subcategories.find((s) => s.id === t.subcategoryId)?.name ??
                    null
                  : null
              }
              fromAccountName={accountName(t.accountId)}
              toAccountName={accountName(t.toAccountId)}
              resolve={resolve}
              onClick={() => form.openEdit(t)}
            />
          ))
        ) : (
          <div className="empty-state" style={{ padding: "24px 8px" }}>
            <p>هنوز تراکنشی ثبت نشده</p>
            <p style={{ fontSize: 11.5, marginTop: 4 }}>
              از میان‌بُرهای بالا شروع کنید
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
