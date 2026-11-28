import { FitText, CurrencyUnit } from "@/shared/ui";

/** Formatting stays with the caller so exact decimal money never becomes Number. */
export function WalletAmount({ formattedAmount, currency, className = "" }: {
  formattedAmount: string; currency: string; className?: string;
}) {
  return <span className={`wallet-amount ${className}`} dir="rtl">
    <FitText min={11.5}>
      <bdi dir="ltr">{formattedAmount}</bdi>
    </FitText>
    <CurrencyUnit className="wallet-amount-unit" currency={currency} />
  </span>;
}
