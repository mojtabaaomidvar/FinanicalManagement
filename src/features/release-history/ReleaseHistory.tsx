import { useEffect, useRef } from "react";
import history from "virtual:release-history";
import { APP_VERSION } from "@/shared/config/version";
import { Modal } from "@/shared/ui/Modal";
import { ReleaseHistoryList } from "./ReleaseHistoryList";

export function ReleaseHistoryDialog({ open, close }: { open: boolean; close: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    dialog.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, [open]);
  return <Modal open={open} onClose={close} sheetClassName="release-history-sheet" dragToClose dialogSemantics={false}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="release-history-title" tabIndex={-1}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button, summary, a[href], [tabindex="0"]');
        if (!controls?.length) { event.preventDefault(); return; }
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}>
      <div className="release-history-heading"><h2 id="release-history-title">تاریخچهٔ نسخه‌ها</h2>
        <button type="button" className="btn-ghost" onClick={close}>بستن تاریخچه</button></div>
      <p className="release-history-hint">تغییرات نسخه‌های برنامه تا نسخهٔ نصب‌شده روی این دستگاه؛ بدون نیاز به اینترنت.</p>
      <ReleaseHistoryList releases={history.releases} activeVersion={APP_VERSION} />
    </section>
  </Modal>;
}
