import { useApp } from "@/app/providers/AppProvider";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";

/** A display preference, or an explicitly isolated input conversion. */
export function CurrencyUnit({ currency, onSwitch, disabled = false, className = "" }: {
  currency?: string; onSwitch?: (next: string) => void; disabled?: boolean; className?: string;
}) {
  const app = useApp();
  const unit = currency ?? app.cur;
  return <button type="button" className={`currency-unit ${className}`} disabled={disabled || (!onSwitch && app.currencyBusy)}
    aria-label={onSwitch ? "تغییر واحد ورودی مبلغ" : "تغییر سراسری واحد نمایش مبالغ"}
    aria-busy={!onSwitch && app.currencyBusy}
    onKeyDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      const next = unit === "ریال" ? "تومان" : "ریال";
      if (onSwitch) onSwitch(next); else void app.changeDisplayCurrency(next);
    }}>{currencyDisplayLabel(unit)}</button>;
}
