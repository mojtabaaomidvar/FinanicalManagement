import { useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { useToast } from "@/app/providers/ToastProvider";
import { useOnline } from "@/shared/lib/useOnline";
import { Card } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";

export function ShoppingSyncStatus({ title = "وضعیت خرید، انبار و کارهای خانه" }: { title?: string } = {}) {
  const { shoppingSync, discardShoppingChange, retryShoppingSync } = useApp();
  const { show } = useToast();
  const online = useOnline();
  const offline = !online || shoppingSync.offline;
  const [acting, setActing] = useState<string | null>(null);

  if (!offline && !shoppingSync.pendingCount && !shoppingSync.issues.length
    && !shoppingSync.syncing && shoppingSync.storageAvailable) return null;

  const syncedDate = shoppingSync.lastSyncedAt
    ? new Date(shoppingSync.lastSyncedAt) : null;
  const lastSync = syncedDate && Number.isFinite(syncedDate.getTime())
    ? syncedDate.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" })
    : null;

  async function discard(operationId: string) {
    if (acting || !confirm("تغییر این دستگاه کنار گذاشته شود و اطلاعات سرور نمایش داده شود؟")) return;
    setActing(operationId);
    try {
      await discardShoppingChange(operationId);
    } catch (error) {
      show((error as Error).message || "کنار گذاشتن تغییر ناموفق بود");
    } finally {
      setActing(null);
    }
  }

  async function retry() {
    if (acting || !online || shoppingSync.syncing) return;
    setActing("retry");
    try {
      await retryShoppingSync();
    } catch (error) {
      show((error as Error).message || "ارسال تغییرها ناموفق بود");
    } finally {
      setActing(null);
    }
  }

  return (
    <Card title={title}>
      <div className="shopping-sync-content">
        <div role="status" aria-live="polite">
          {offline ? <p className="form-note">اطلاعات ذخیره‌شده روی این دستگاه نمایش داده می‌شود.</p> : null}
          {shoppingSync.syncing ? <p className="form-note">در حال ارسال تغییرها…</p> : null}
          {shoppingSync.pendingCount ? (
            <p className="form-note">
              {toFa(shoppingSync.pendingCount)} تغییر در انتظار ارسال یا بررسی است.
              {!shoppingSync.issues.length ? " پس از اتصال، خودکار ارسال می‌شود." : ""}
            </p>
          ) : null}
          {offline && lastSync ? <p className="form-note">آخرین دریافت: {lastSync}</p> : null}
          {!shoppingSync.storageAvailable ? (
            <p className="form-note">نگه‌داشتن امن تغییرها روی این دستگاه در دسترس نیست. تغییرهای آفلاین ثبت نمی‌شوند.</p>
          ) : null}
        </div>
        {shoppingSync.issues.length ? (
          <>
            <p className="form-note">این تغییرها ارسال نشده‌اند و برای بررسی نگه داشته شده‌اند.</p>
            <ul className="shopping-sync-issues">
              {shoppingSync.issues.map((issue) => (
                <li key={issue.operationId}>
                  <p className="form-note">{issue.message}</p>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={acting !== null || shoppingSync.syncing}
                    onClick={() => void discard(issue.operationId)}
                  >
                    {acting === issue.operationId ? "…" : "پذیرفتن نسخهٔ سرور"}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {shoppingSync.pendingCount && online ? (
          <button
            type="button"
            className="btn-ghost"
            disabled={acting !== null || shoppingSync.syncing}
            onClick={() => void retry()}
          >
            {acting === "retry" ? "…" : "تلاش دوباره"}
          </button>
        ) : null}
      </div>
    </Card>
  );
}
