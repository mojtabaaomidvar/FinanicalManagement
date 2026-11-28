/* Modal — شیت پایین صفحه با بستن با کلیک بیرون/Escape
   با Portal روی body رندر می‌شود تا والد دارای backdrop-filter/transform
   (مثل هدر اپ) آن را به‌جای viewport، به‌اندازه خودش برش نزند.

   padded={false} → شیت بدون padding داخلی (شیت‌های تمام‌قد سفارشی)
   dragToClose → کشیدن به پایین از بالای شیت (لمس موبایل) = بستن */

import {
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
} from "react";
import { RetainedPortal } from "./RetainedPortal";
import { useBackGuard } from "@/shared/lib/useBackGuard";
import { usePageActivity } from "@/shared/lib/pageActivity";
import { useDialogFocus } from "./dialogFocus";
import "./Modal.css";

export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  sheetClassName?: string;
  overlayClassName?: string;
  /** استایل inline روی خود شیت */
  style?: CSSProperties;
  /** بدون padding پیش‌فرض — شیت خودش چیدمان داخلی را مدیریت می‌کند */
  padded?: boolean;
  /** کشیدن به پایین (لمس) از ناحیه بالای شیت = بستن */
  dragToClose?: boolean;
  fullscreenOnMobile?: boolean;
  ariaLabel?: string;
  dialogSemantics?: boolean;
}) {
  const active = usePageActivity();
  const visible = props.open && active;
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const drag = useRef({ active: false, startY: 0, y: 0 });
  /* بازگشت فیزیکی/نرم‌افزاری و سوایپ لبه = بستن این مودال (LIFO) */
  const order = useBackGuard(props.open, props.onClose);
  useDialogFocus(sheetRef, visible, order, props.onClose);

  if (!props.open) return null;

  /* ── کشیدن برای بستن — فقط وقتی شیت در بالای اسکرول است ── */
  function onTouchStart(e: TouchEvent) {
    /* مودال رویی با Portal روی body می‌نشیند، اما رویداد ری‌اکت از درخت
       کامپوننت بالا می‌آید؛ پس لمس داخل مودال رویی به این هندلر هم می‌رسد.
       بدون این نگهبان، اسکرول در «ورود پیامک» شیت تراکنش زیر آن را می‌بندد. */
    if (!props.dragToClose) return;
    if (sheetRef.current?.closest("[inert]")) return;
    const sheet = sheetRef.current;
    if (!sheet || sheet.scrollTop > 0) return;
    drag.current = { active: true, startY: e.touches[0].clientY, y: 0 };
    sheet.style.transition = "none";
  }

  function onTouchMove(e: TouchEvent) {
    const d = drag.current;
    if (!d.active || !sheetRef.current) return;
    d.y = e.touches[0].clientY - d.startY;
    if (d.y > 0)
      sheetRef.current.style.transform = `translateY(${d.y * 0.85}px)`;
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

  return <RetainedPortal visible={visible} order={order!}>
    <div
      className={`modal-overlay${props.fullscreenOnMobile ? " is-mobile-fullscreen-overlay" : ""} ${props.overlayClassName ?? ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={`modal-sheet ${props.padded === false ? "no-pad" : ""}${props.fullscreenOnMobile ? " is-mobile-fullscreen" : ""} ${props.sheetClassName ?? ""}`}
        role={props.dialogSemantics === false ? undefined : "dialog"}
        aria-modal={props.dialogSemantics === false ? undefined : true}
        aria-labelledby={props.dialogSemantics === false || !props.title ? undefined : titleId}
        aria-label={props.dialogSemantics === false || props.title ? undefined : (props.ariaLabel ?? "پنجره")}
        tabIndex={-1}
        style={props.style}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div className="modal-grabber" />
        {props.title ? <h3 id={titleId}>{props.title}</h3> : null}
        {props.children}
      </div>
    </div>
  </RetainedPortal>;
}
