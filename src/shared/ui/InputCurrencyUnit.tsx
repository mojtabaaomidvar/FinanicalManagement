import { useToast } from "@/app/providers/ToastProvider";
import { convertMoneyDraft } from "@/shared/lib/moneyDraft";
import { CurrencyUnit } from "./CurrencyUnit";

export function InputCurrencyUnit({ value, currency, onChange, disabled = false }: {
  value: string; currency: string; onChange: (value: string, currency: string) => void; disabled?: boolean;
}) {
  const { show } = useToast();
  return <CurrencyUnit currency={currency} disabled={disabled} onSwitch={next => {
    const converted = convertMoneyDraft(value, currency, next);
    if (converted === null) { show("مبلغ را کامل و معتبر وارد کنید تا واحد ورودی تغییر کند."); return; }
    onChange(converted, next);
  }} />;
}
