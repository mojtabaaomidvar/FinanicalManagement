import { useEffect, useRef, type ReactNode } from "react";
import { Modal } from "@/shared/ui";

/** Focus behavior is scoped to meals; unrelated application dialogs are unchanged. */
export function MealDialog({ open, title, onClose, children, fullscreenOnMobile }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
  fullscreenOnMobile?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = ref.current;
    element?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !element) return;
      const controls = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(control => control.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); element.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === element)) { event.preventDefault(); first.focus(); }
    };
    element?.addEventListener("keydown", trap);
    return () => { element?.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <Modal open={open} onClose={onClose} sheetClassName="meals-sheet" dragToClose dialogSemantics={false} fullscreenOnMobile={fullscreenOnMobile}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="meal-dialog">
      <div className="meal-dialog-title"><h2>{title}</h2><button className="meal-close" type="button" aria-label="بستن پنجرهٔ غذا" onClick={onClose}>×</button></div>
      {children}
    </div>
  </Modal>;
}
