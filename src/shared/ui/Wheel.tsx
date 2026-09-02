/* چرخ‌انداز عمودی به سبک iOS — اسکرول-اسنپ + نوار هایلایت مرکزی
   استفاده: انتخاب ماه/سال در دیت‌پیکر و ساعت/دقیقه در انتخابگر زمان */

import { useEffect, useRef } from "react";

const ITEM_H = 40;

export function WheelColumn({
  items,
  value,
  onChange,
}: {
  items: { value: number; label: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);

  /* همگام‌سازی اسکرول با مقدار: در mount و تغییرات بیرونی (مثل دکمه «الان») */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const idx = items.findIndex((i) => i.value === value);
    if (idx < 0) return;
    if (Math.round(el.scrollTop / ITEM_H) !== idx) {
      el.scrollTop = idx * ITEM_H;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /* توقف اسکرول → آیتم مرکزی انتخاب می‌شود */
  function onScroll() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const idx = Math.min(
        items.length - 1,
        Math.max(0, Math.round(el.scrollTop / ITEM_H)),
      );
      const it = items[idx];
      if (it && it.value !== value) onChange(it.value);
    }, 130);
  }

  return (
    <div className="wheel-col">
      <div className="wheel-scroll" ref={ref} onScroll={onScroll}>
        <div className="wheel-spacer" />
        {items.map((it) => (
          <button
            type="button"
            key={it.value}
            className={`wheel-item ${it.value === value ? "active" : ""}`}
            onClick={() => {
              const idx = items.findIndex((i) => i.value === it.value);
              ref.current?.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
            }}
          >
            {it.label}
          </button>
        ))}
        <div className="wheel-spacer" />
      </div>
      <div className="wheel-hl" />
    </div>
  );
}
