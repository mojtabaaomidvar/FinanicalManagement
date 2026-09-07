/* useBackGuard — به‌ازای هر لایهٔ باز، یک ورودیِ بازگشت ثبت می‌کند.
   وقتی open=true شود، لایه به پشتهٔ backGuard افزوده می‌شود؛ با بازگشتِ
   کاربر (دکمه/سوایپ) تابع onClose صدا می‌خورد. اگر لایه برنامه‌ای بسته
   شود (open=false)، ورودیِ تاریخچه‌اش پس گرفته می‌شود. */

import { useEffect, useRef } from "react";
import { popGuard, pushGuard } from "./backGuard";

export function useBackGuard(open: boolean, onClose: () => void) {
  /* onClose تازه بدون وابسته‌کردن افکت به آن — وگرنه هر رندر لایه را
     برداشته و دوباره push می‌کند (همان الگوی Modal برای Escape). */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const id = pushGuard(() => closeRef.current());
    return () => popGuard(id);
  }, [open]);
}
