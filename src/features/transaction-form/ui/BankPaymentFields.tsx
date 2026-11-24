import type { PaymentMethod, TransferFeeMethod } from "@/domain/transaction/transaction.types";
import { Select } from "@/shared/ui";

/** Payment choice is distinct from the transfer tariff and is persisted explicitly. */
export function BankPaymentFields({ mode, choice, paymentMethod = "", method, onChoice, onPaymentMethod, onMethod, loading = false, error = null }: {
  mode: "expense" | "transfer";
  choice: "" | "yes" | "no";
  method: "" | TransferFeeMethod;
  onChoice: (choice: "yes" | "no") => void;
  paymentMethod?: "" | PaymentMethod;
  onPaymentMethod?: (method: PaymentMethod) => void;
  onMethod: (method: "" | TransferFeeMethod) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const expense = mode === "expense";
  return <div className="tx-transfer-fee bank-payment-method">
    <p>{expense ? "این هزینه را چطور پرداخت کردی؟" : "این انتقال کارمزد هم داشت؟"}</p>
    <div className="quick-chips" role="group" aria-label={expense ? "روش پرداخت هزینه" : "کارمزد انتقال"}>
      {expense ? <>
        <button type="button" className={`chip ${paymentMethod === "card" ? "active" : ""}`} aria-pressed={paymentMethod === "card"}
          onClick={() => onPaymentMethod?.("card")}>کارت کشیدم</button>
        <button type="button" className={`chip ${paymentMethod === "online" ? "active" : ""}`} aria-pressed={paymentMethod === "online"}
          onClick={() => onPaymentMethod?.("online")}>پرداخت آنلاین</button>
        <button type="button" className={`chip ${paymentMethod === "bank_transfer" ? "active" : ""}`} aria-pressed={paymentMethod === "bank_transfer"}
          onClick={() => onPaymentMethod?.("bank_transfer")}>انتقال بانکی</button>
      </> : <>
        <button type="button" className={`chip ${choice === "yes" ? "active" : ""}`} aria-pressed={choice === "yes"}
          onClick={() => onChoice("yes")}>بله</button>
        <button type="button" className={`chip ${choice === "no" ? "active" : ""}`} aria-pressed={choice === "no"}
          onClick={() => onChoice("no")}>خیر</button>
      </>}
    </div>
    {(expense ? paymentMethod === "bank_transfer" : choice === "yes") ? <label>نوع انتقال
      <Select aria-label="نوع انتقال بانکی" value={method} onChange={value => onMethod(value as TransferFeeMethod | "")}
        options={[{ value: "", label: "نوع انتقال را انتخاب کنید…" },
          { value: "internal", label: "داخلی (حساب به حساب)" }, { value: "card_to_card", label: "کارت‌به‌کارت" },
          { value: "paya", label: "پایا" }, { value: "satna", label: "ساتنا" }, { value: "pol", label: "پل" }]} />
    </label> : null}
    {loading ? <p className="tx-simple-hint" role="status">در حال بررسی حساب…</p> : null}
    {error ? <p className="field-error" role="alert">{error}</p> : null}
  </div>;
}
