/* useBackGuard — به‌ازای هر لایهٔ باز، یک ورودی بازگشت ثبت می‌کند.
   وقتی open=true شود، لایه به پشتهٔ backGuard افزوده می‌شود؛ با بازگشت
   کاربر (دکمه/سوایپ) تابع onClose صدا می‌خورد. اگر لایه برنامه‌ای بسته
   شود (open=false)، ورودی تاریخچه‌اش پس گرفته می‌شود. */

import { useEffect, useRef } from "react";
import { nextGuardOrder, popGuard, pushOrderedGuard } from "./backGuard";
import { usePageActivity } from "./pageActivity";

export function useBackGuard(open: boolean, onClose: () => void) {
  const active = usePageActivity();
  const orderRef = useRef<number | null>(null);
  if (!open) orderRef.current = null;
  else orderRef.current ??= nextGuardOrder();
  /* onClose تازه بدون وابسته‌کردن افکت به آن — وگرنه هر رندر لایه را
     برداشته و دوباره push می‌کند (همان الگوی Modal برای Escape). */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !active) return;
    const id = pushOrderedGuard(() => closeRef.current(), orderRef.current!);
    return () => popGuard(id);
  }, [open, active]);
  return orderRef.current;
}
