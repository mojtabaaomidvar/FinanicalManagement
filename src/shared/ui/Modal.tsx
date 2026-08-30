/* Modal — شیت پایین صفحه با بستن با کلیک بیرون/Escape */

import { useEffect, type ReactNode } from "react";

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  sheetClassName?: string;
}) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={`modal-sheet ${props.sheetClassName ?? ""}`}>
        <div className="modal-grabber" />
        {props.title ? <h3>{props.title}</h3> : null}
        {props.children}
      </div>
    </div>
  );
}
