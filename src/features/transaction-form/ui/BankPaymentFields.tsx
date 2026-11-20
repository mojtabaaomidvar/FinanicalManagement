import type { TransferFeeMethod } from "@/domain/transaction/transaction.types";
import { Select } from "@/shared/ui";

/** The expense question maps card payments to no transfer tariff. */
export function BankPaymentFields({ mode, choice, method, onChoice, onMethod, loading = false, error = null }: {
  mode: "expense" | "transfer";
  choice: "" | "yes" | "no";
  method: "" | TransferFeeMethod;
  onChoice: (choice: "yes" | "no") => void;
  onMethod: (method: "" | TransferFeeMethod) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const expense = mode === "expense";
  const firstChoice = expense ? "no" : "yes";
  const secondChoice = expense ? "yes" : "no";
  return <div className="tx-transfer-fee bank-payment-method">
    <p>{expense ? "این هزینه را با کارت پرداخت کردی؟" : "این انتقال کارمزد هم داشت؟"}</p>
    <div className="quick-chips" role="group" aria-label={expense ? "روش پرداخت هزینه" : "کارمزد انتقال"}>
      <button type="button" className={`chip ${choice === firstChoice ? "active" : ""}`} aria-pressed={choice === firstChoice}
        onClick={() => onChoice(firstChoice)}>{expense ? "بله، کارت کشیدم" : "بله"}</button>
      <button type="button" className={`chip ${choice === secondChoice ? "active" : ""}`} aria-pressed={choice === secondChoice}
        onClick={() => onChoice(secondChoice)}>{expense ? "خیر، انتقال بانکی بود" : "خیر"}</button>
    </div>
    {choice === "yes" ? <label>نوع انتقال
      <Select aria-label="نوع انتقال بانکی" value={method} onChange={value => onMethod(value as TransferFeeMethod | "")}
        options={[{ value: "", label: "نوع انتقال را انتخاب کنید…" },
          { value: "internal", label: "داخلی (حساب به حساب)" }, { value: "card_to_card", label: "کارت‌به‌کارت" },
          { value: "paya", label: "پایا" }, { value: "satna", label: "ساتنا" }, { value: "pol", label: "پل" }]} />
    </label> : null}
    {loading ? <p className="tx-simple-hint" role="status">در حال بررسی حساب…</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </div>;
}
