import { useEffect, useState } from "react";
import type { UseCases } from "@/application/useCases";
import type { TransferFeeMethod } from "@/domain/transaction/transaction.types";
import { compareMoney, convertMoney, moneyFits, type Money } from "@/shared/lib/money";

/** A quote belongs to one form/account/amount snapshot. Stale replies never filter a new selection. */
export function useTransferFeeQuote(useCases: UseCases | null, scope: string, method: TransferFeeMethod | "", amount: Money | null) {
  const key = method && amount !== null && compareMoney(amount, "0") > 0 ? `${scope}:${method}:${amount}` : "";
  const [result, setResult] = useState<{ key: string; useCases: UseCases; rial?: Money; error?: string } | null>(null);
  useEffect(() => {
    if (!key || !method || amount === null || !useCases) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const rial = convertMoney(amount, "ریال");
      if (!moneyFits(rial, { scale: 0, min: "1", max: "9999999999990" })) {
        setResult({ key, useCases, error: "مبلغ پرداخت باید عدد صحیح مثبت به ریال باشد." });
        return;
      }
      void useCases.quoteTransferFee.execute(method, rial).then(value => {
        if (active) setResult({ key, useCases, rial: value });
      }, () => {
        if (active) setResult({ key, useCases, error: "بررسی حساب ممکن نشد؛ دوباره تلاش کنید یا هنگام ثبت بررسی کنید." });
      });
    }, 200);
    return () => { active = false; window.clearTimeout(timer); };
  }, [useCases, key, method, amount]);
  const current = key && result?.key === key && result.useCases === useCases ? result : null;
  return { rial: current?.rial ?? "0", loading: !!key && !current, error: current?.error ?? null };
}
