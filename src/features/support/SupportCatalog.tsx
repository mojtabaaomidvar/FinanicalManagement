import { useEffect, useRef, useState } from "react";
import { AppError } from "@/shared/lib/appError";
import { INVENTORY_GROUP_LABELS } from "@/domain/inventory/inventory.labels";
import type { InventoryCatalogGroup } from "@/domain/inventory/inventory.catalog";
import { supportApi, type CatalogProposal, type CatalogProposals } from "./api";

const statusLabels: Record<CatalogProposal["status"], string> = {
  pending: "در انتظار بررسی", approved: "تأییدشده؛ منتظر انتشار نسخه", rejected: "ردشده",
};

export function SupportCatalog({ refresh, onSessionExpired }: { refresh: number; onSessionExpired: () => void }) {
  const [status, setStatus] = useState("pending");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<CatalogProposals | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  const expired = useRef(onSessionExpired); expired.current = onSessionExpired;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function failure(cause: unknown) {
    if (cause instanceof AppError && cause.serverCode === "SUPPORT_UNAUTHORIZED") expired.current();
    else setError(cause instanceof Error ? cause.message : "بررسی پیشنهادها انجام نشد؛ دوباره تلاش کنید.");
  }
  useEffect(() => {
    let current = true;
    setLoading(true); setData(null); setError("");
    void supportApi.catalog(status, offset).then(value => {
      if (current) {
        if (!value.items.length && offset > 0) setOffset(Math.max(0, offset - 25));
        else setData(value);
      }
    }).catch(cause => { if (current) failure(cause); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [status, offset, refresh, revision]);

  async function review(item: CatalogProposal, next: "approved" | "rejected") {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      await supportApi.reviewCatalog(item.id, next);
      if (!mounted.current) return;
      setMessage(next === "approved" ? "پیشنهاد تأیید شد؛ تا بازبینی و انتشار نسخه، به فهرست عمومی اضافه نمی‌شود." : "پیشنهاد رد شد.");
      setRevision(value => value + 1);
    } catch (cause) { if (mounted.current) failure(cause); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  function downloadApprovedPage() {
    const rows = data?.items.filter(item => item.status === "approved") ?? [];
    if (!rows.length) return;
    const blob = new Blob([JSON.stringify(rows.map(({ title, category, unit }) => ({ title, category, unit })), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `catalog-reviewed-page-${Math.floor(offset / 25) + 1}.json`;
    link.click(); URL.revokeObjectURL(url);
  }

  return <section className="support-section support-catalog" aria-busy={busy || loading}>
    <div className="support-catalog-heading"><div><h2>پیشنهاد کالاهای تازه</h2>
      <p>فقط نام، دسته و واحد ارسال شده‌اند؛ مقدار موجودی و اطلاعات خانواده در این صف نیست.</p>
      <p>تأیید، انتشار نیست. کالا پس از بازبینی نهایی و انتشار نسخه وارد فهرست مشترک می‌شود.</p></div>
      <label>وضعیت بررسی<select aria-label="وضعیت بررسی پیشنهاد کالا" value={status} disabled={busy}
        onChange={event => { setStatus(event.target.value); setOffset(0); setMessage(""); }}>
        <option value="pending">در انتظار بررسی</option><option value="approved">تأییدشده</option>
        <option value="rejected">ردشده</option><option value="all">همهٔ وضعیت‌ها</option></select></label></div>
    {message && <p role="status">{message}</p>}
    {error && <div className="support-state" role="alert"><p>{error}</p>
      <button disabled={busy} onClick={() => setRevision(value => value + 1)}>تلاش دوباره</button></div>}
    {loading ? <div className="support-state" role="status">در حال دریافت پیشنهادهای کالا…</div>
      : data && !data.items.length ? <div className="support-state" role="status">پیشنهادی با این وضعیت وجود ندارد.</div>
        : data && <><ul className="support-catalog-list">{data.items.map(item => <li key={item.id}>
          <div><h3><bdi>{item.title}</bdi></h3><p>{INVENTORY_GROUP_LABELS[item.category as InventoryCatalogGroup] ?? "دستهٔ نامشخص"}
            <span> · </span><bdi>{item.unit ?? "بدون واحد"}</bdi></p><span className="support-badge">{statusLabels[item.status]}</span></div>
          {item.status === "pending" && <div className="support-catalog-actions">
            <button className="support-primary" disabled={busy} onClick={() => void review(item, "approved")}>تأیید برای بازبینی</button>
            <button disabled={busy} onClick={() => void review(item, "rejected")}>رد پیشنهاد</button></div>}
        </li>)}</ul>
        {data.items.some(item => item.status === "approved") && <button disabled={busy} onClick={downloadApprovedPage}>دریافت تأییدشده‌های این صفحه</button>}
        <div className="support-pagination"><button disabled={busy || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))}>قبلی</button>
          <span>صفحهٔ {(Math.floor(offset / 25) + 1).toLocaleString("fa-IR")}</span>
          <button disabled={busy || offset + data.items.length >= data.total} onClick={() => setOffset(value => value + 25)}>بعدی</button></div></>}
  </section>;
}
