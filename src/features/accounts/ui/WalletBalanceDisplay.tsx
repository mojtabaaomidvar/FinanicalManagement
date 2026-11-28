import type { WalletBalanceState } from "../model/useWalletBalances";
import { compareMoney, formatMoney } from "@/shared/lib/money";
import { WalletAmount } from "./WalletAmount";
import { NegativeBalanceNotice } from "./NegativeBalanceNotice";

export function WalletBalanceDisplay({ state, currency, className }: {
  state?: WalletBalanceState; currency: string; className: string;
}) {
  if (!state || state.status === "loading") return <p role="status">در حال دریافت موجودی…</p>;
  if (state.status === "error") return <p className="field-error" role="status">موجودی دریافت نشد؛ دوباره دریافت کنید.</p>;
  const balance = state.value;
  const negative = compareMoney(balance.currentBalance, "0") < 0;
  return <>
    <WalletAmount className={`${className}${negative ? " is-negative" : ""}`}
      formattedAmount={formatMoney(balance.currentBalance, currency)} currency={currency} />
    {negative ? <NegativeBalanceNotice /> : null}
  </>;
}
