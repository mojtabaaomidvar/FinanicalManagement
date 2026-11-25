import type { Account } from "@/domain/account/account.types";
import type { WalletBalanceState } from "../model/useWalletBalances";
import type { WalletBalanceSummary } from "../model/walletBalanceSummary";

/** Retain selected identity and title while unavailable money is never selectable. */
export function pendingWalletOptions(accounts: Account[], rows: ReadonlyMap<string, WalletBalanceState>, ownerId: string | null) {
  return accounts.filter(account => (ownerId === null || account.memberId === ownerId) && rows.get(account.id)?.status !== "ready")
    .map(account => ({ value: account.id, disabled: true,
      label: rows.get(account.id)?.status === "error"
        ? /* @copy-text wallet.account_option.error */ `${account.title} · موجودی دریافت نشد`
        : /* @copy-text wallet.account_option.loading */ `${account.title} · در حال دریافت موجودی…`,
    }));
}

export function WalletAccountStatus({ summary, onRetry }: { summary: WalletBalanceSummary; onRetry: () => void }) {
  if (summary.status === "ready") return null;
  return summary.status === "loading" ? <p className="tx-simple-hint" role="status">در حال دریافت موجودی حساب‌ها…</p>
    : <div className="tx-simple-hint" role="status"><p>موجودی بعضی حساب‌ها دریافت نشد؛ انتخاب قبلی حفظ شده است.</p>
      <button type="button" className="btn-secondary" onClick={onRetry}>دریافت دوبارهٔ موجودی</button></div>;
}
