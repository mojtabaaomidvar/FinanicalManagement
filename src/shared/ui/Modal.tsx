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

/* پشتهٔ مودال‌های باز — چون مودال می‌تواند روی مودال باز شود
   (مثل «ورود پیامک» روی شیت ثبت تراکنش):
   • Escape فقط بالاترین مودال را می‌بندد، نه همه را
   • اسکرول body تنها وقتی آزاد می‌شود که آخرین مودال هم بسته شده باشد */
const openStack: symbol[] = [];

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
  /* شناسه ثابت این مودال در پشته */
  const idRef = useRef<symbol | null>(null);
  idRef.current ??= Symbol("modal");
  /* onClose تازه بدون وابسته‌کردن افکت به آن — وگرنه هر رندر
     مودال را از پشته برداشته و دوباره بالا می‌گذارد */
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

  useEffect(() => {
    if (!props.open) return;
    const id = idRef.current!;
    openStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openStack[openStack.length - 1] === id) {
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      const i = openStack.lastIndexOf(id);
      if (i !== -1) openStack.splice(i, 1);
      if (!openStack.length) document.body.style.overflow = "";
    };
  }, [props.open]);

  if (!props.open) return null;

  /* ── کشیدن برای بستن — فقط وقتی شیت در بالای اسکرول است ── */
  function onTouchStart(e: TouchEvent) {
    /* مودالِ رویی با Portal روی body می‌نشیند، اما رویداد ری‌اکت از درخت
       کامپوننت بالا می‌آید؛ پس لمس داخل مودال رویی به این هندلر هم می‌رسد.
       بدون این نگهبان، اسکرول در «ورود پیامک» شیت تراکنش زیر آن را می‌بندد. */
    if (!props.dragToClose) return;
    if (openStack[openStack.length - 1] !== idRef.current) return;
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
