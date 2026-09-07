/* متن خودتنظیم — فونت را خودکار کوچک می‌کند تا متن در عرض ظرف جا شود
   (برای اعداد پولی که روی نمایشگرهای کوچک سرریز/هم‌پوشانی می‌شوند).

   - اندازه پایه (بیشینه) از CSS همان جایگاه خوانده می‌شود؛ این کامپوننت
     فقط در صورت سرریز، فونت را به نسبت «عرض ظرف ÷ عرض متن» کوچک می‌کند.
   - با ResizeObserver روی تغییر اندازه ظرف (چرخش صفحه، تغییر فونت سیستمی)
     دوباره تنظیم می‌شود.
   - min: کف اندازه — پایین‌تر از آن کوچک نمی‌شود. */

import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

export function FitText({
  children,
  min = 9,
  className,
  style,
}: {
  children: ReactNode;
  /** حداقل اندازه فونت (px) */
  min?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        /* بازنشانی به اندازه CSS (پایه) و اندازه‌گیری مجدد */
        outer.style.fontSize = "";
        const base = parseFloat(getComputedStyle(outer).fontSize);
        const need = inner.scrollWidth;
        const avail = outer.clientWidth;
        if (need > avail && avail > 0 && base > min) {
          const size = Math.max(min, (base * avail) / need);
          outer.style.fontSize = `${Math.floor(size * 100) / 100}px`;
        }
      });
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(outer);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [children, min]);

  return (
    <span
      ref={outerRef}
      className={`fit-text ${className ?? ""}`}
      style={style}
    >
      <span ref={innerRef} className="fit-text-inner">
        {children}
      </span>
    </span>
  );
}
