import type { HoldingsModel } from "./useHoldings";

export function HoldingsStatus({ model }: { model: HoldingsModel }) {
  if (model.loading) {
    return <p className="section-hint" role="status">در حال دریافت دارایی‌ها…</p>;
  }
  if (!model.loadError) return null;
  return (
    <div role="alert">
      {model.refreshFailed ? (
        <p className="section-hint">تغییر ذخیره شد؛ فهرست دارایی‌ها تازه نشد.</p>
      ) : null}
      <p className="field-error">{model.loadError}</p>
      <button
        type="button"
        className="btn-secondary"
        disabled={model.busy}
        onClick={() => void model.reload()}
      >
        دریافت دوباره دارایی‌ها
      </button>
    </div>
  );
}
