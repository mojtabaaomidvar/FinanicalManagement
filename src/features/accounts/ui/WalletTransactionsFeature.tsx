import type { Account } from "@/domain/account/account.types";
import type { UseCases } from "@/application/useCases";
import type { WalletBalanceState } from "../model/useWalletBalances";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { TransactionListFeature } from "@/features/transaction-list";
import { TransactionFormFeature, useTxFormModel } from "@/features/transaction-form";
import { AppPage, PageNavigationContext } from "@/shared/ui/AppPage";
import { WalletBalanceDisplay } from "./WalletBalanceDisplay";

function WalletTransactionContent({ account, useCases }: { account: Account; useCases: UseCases }) {
  const { members, member, cur, subcategories, refreshData } = useApp();
  const { show } = useToast();
  const form = useTxFormModel(useCases, members, member?.id ?? "", show, cur, subcategories);
  return <>
    <TransactionListFeature form={form} fixedAccountId={account.id} />
    <TransactionFormFeature form={form} onImported={refreshData} />
  </>;
}

export function WalletTransactionsFeature({ account, balance, onBack, onRefresh, embedded = false }: {
  account?: Account; balance?: WalletBalanceState; onBack: () => void; onRefresh: () => void; embedded?: boolean;
}) {
  const { useCases, cur } = useApp();
  const header = <header className="app-header accounts-page-header">
    {embedded ? <button type="button" className="icon-btn" aria-label="بازگشت به کیف پول‌ها" onClick={onBack}><svg aria-hidden="true"><use href="#i-arrow-r" /></svg></button> : null}
    <div className="header-title"><h1>تراکنش‌های کیف پول</h1><p>{account?.title}</p></div>
  </header>;
  const content = <div className="content">
    {!account ? <p role="alert">این کیف پول دیگر در دسترس نیست؛ به فهرست کیف پول‌ها برگردید.</p> : <>
      <section className="balance-card">
        <p>موجودی فعلی کیف پول</p>
        <WalletBalanceDisplay state={balance} currency={cur} className="wallet-balance" />
        <button type="button" className="btn-secondary" onClick={onRefresh}>دریافت دوبارهٔ موجودی</button>
      </section>
      {useCases ? <WalletTransactionContent account={account} useCases={useCases} /> : <p role="status">در حال آماده‌سازی تراکنش‌ها…</p>}
    </>}
  </div>;
  return embedded ? <div className="wallet-transactions">{header}{content}</div> : <PageNavigationContext.Provider value={{ back: onBack, canBack: true }}>
    <AppPage className="page active">{header}{content}</AppPage>
  </PageNavigationContext.Provider>;
}
