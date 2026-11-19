import { Icon } from "@/shared/ui";
import type { useMarket } from "./useMarket";

type MarketStatusProps = Pick<ReturnType<typeof useMarket>, "data" | "error" | "loading" | "refresh">;

export function MarketStatus({ data, error, loading, refresh }: MarketStatusProps) {
  return (
    <>
      {loading ? (
        <p className="section-hint" role="status">
          <span className="spinner" />
          {data ? "در حال تازه‌سازی قیمت‌ها…" : "در حال دریافت قیمت‌ها…"}
        </p>
      ) : null}
      {error ? (
        <div className={data ? undefined : "empty-state"} role="alert">
          {!data ? (
            <span className="empty-icon" aria-hidden="true">
              <Icon name="i-alert" size={28} />
            </span>
          ) : null}
          {data ? (
            <p className="section-hint">قیمت‌ها تازه نشد؛ آخرین قیمت‌های دریافت‌شده نمایش داده می‌شوند.</p>
          ) : null}
          <p className="field-error">{error}</p>
          <button type="button" className="btn-secondary" disabled={loading} onClick={() => void refresh()}>
            تلاش دوباره
          </button>
        </div>
      ) : null}
      {data?.stale && !error ? (
        <p className="section-hint" role="status">این قیمت‌ها ممکن است قدیمی باشند.</p>
      ) : null}
    </>
  );
}
