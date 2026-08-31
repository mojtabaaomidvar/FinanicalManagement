/* Modal — شیت پایین صفحه با بستن با کلیک بیرون/Escape
   با Portal روی body رندر می‌شود تا والد دارای backdrop-filter/transform
   (مثل هدر اپ) آن را به‌جای viewport، به‌اندازه خودش برش نزند. */

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

  return createPortal(
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
    </div>,
    document.body,
  );
}
