/* Modal — شیت پایین صفحه با بستن با کلیک بیرون/Escape
   با Portal روی body رندر می‌شود تا والد دارای backdrop-filter/transform
   (مثل هدر اپ) آن را به‌جای viewport، به‌اندازه خودش برش نزند.

   padded={false} → شیت بدون padding داخلی (شیت‌های تمام‌قد سفارشی)
   dragToClose → کشیدن به پایین از بالای شیت (لمس موبایل) = بستن */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  sheetClassName?: string;
  /** استایل inline روی خود شیت */
  style?: CSSProperties;
  /** بدون padding پیش‌فرض — شیت خودش چیدمان داخلی را مدیریت می‌کند */
  padded?: boolean;
  /** کشیدن به پایین (لمس) از ناحیه بالای شیت = بستن */
  dragToClose?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startY: 0, y: 0 });

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

  /* ── کشیدن برای بستن — فقط وقتی شیت در بالای اسکرول است ── */
  function onTouchStart(e: TouchEvent) {
    if (!props.dragToClose) return;
    const sheet = sheetRef.current;
    if (!sheet || sheet.scrollTop > 0) return;
    drag.current = { active: true, startY: e.touches[0].clientY, y: 0 };
    sheet.style.transition = "none";
  }

  function onTouchMove(e: TouchEvent) {
    const d = drag.current;
    if (!d.active || !sheetRef.current) return;
    d.y = e.touches[0].clientY - d.startY;
    if (d.y > 0) sheetRef.current.style.transform = `translateY(${d.y * 0.85}px)`;
  }

  function onTouchEnd() {
    const d = drag.current;
    if (!d.active || !sheetRef.current) return;
    d.active = false;
    const sheet = sheetRef.current;
    sheet.style.transition = "transform 240ms ease-out";
    if (d.y > 110) {
      props.onClose();
    }
    sheet.style.transform = "";
  }

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`modal-sheet ${props.padded === false ? "no-pad" : ""} ${props.sheetClassName ?? ""}`}
        style={props.style}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="modal-grabber" />
        {props.title ? <h3>{props.title}</h3> : null}
        {props.children}
      </div>
    </div>,
    document.body,
  );
}
