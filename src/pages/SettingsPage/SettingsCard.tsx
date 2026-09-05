/* الگوی «Grouped Settings» — کارت گروهی + ردیف چندحالته
   ─────────────────────────────────────────────────────────
   قواعد طراحی (طبق بریف):
   • هر کارت = یک گروه منطقی؛ کارت‌ها هرگز به هم نمی‌چسبند.
   • داخل کارت خط جداکننده نداریم؛ جدایی فقط با padding و فضای خالی.
   • RTL: آیکون و برچسب راست، عنصر انتهایی چپ، فلش «چپ» (#i-arrow-l).
   • آیکون‌ها تک‌رنگ و خطی (بدون مربع رنگی) — هم‌رنگ متن، کمی روشن‌تر.

   ردیف شش حالت انتهایی دارد که با یک prop انتخاب می‌شود (`trailing.type`):
     chevron | counter | value | toggle | action | stepper

   نکته دسترسی‌پذیری/HTML: ردیفِ toggle خودش دکمه است (سطح لمس بزرگ‌تر)
   و کلید آن یک <span> است، نه دکمه — دکمه تودرتو HTML نامعتبر می‌سازد.
   ردیف stepper هم دو دکمه کوچک دارد، پس خودش <div> می‌ماند. */

import type { ReactNode } from "react";
import { toFa } from "@/shared/lib/digits";

export type RowTrailing =
  /** فقط فلش — زیرصفحه‌ای بدون مقدار */
  | { type: "chevron" }
  /** شمارنده + فلش — «دسته‌بندی‌ها ۲۹» */
  | { type: "counter"; count: number }
  /** مقدار خاکستری + فلش — «ارز اصلی: تومان» */
  | { type: "value"; value: string }
  /** کلید روشن/خاموش — بدون فلش */
  | { type: "toggle"; on: boolean; onChange: (next: boolean) => void }
  /** واژه پررنگ به‌جای فلش — وقتی چیزی هنوز تنظیم نشده: «افزودن» */
  | { type: "action"; label: string }
  /** انتخاب محدود و ترتیبی — مقدار + دو فلش بالا/پایین */
  | {
      type: "stepper";
      value: string;
      onStep: (dir: 1 | -1) => void;
      canUp?: boolean;
      canDown?: boolean;
    };

export function SettingsCard({
  title,
  children,
}: {
  /** عنوان کوچک بالای کارت — اختیاری (کارت پروفایل عنوان ندارد) */
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="set-group">
      {title ? <h2 className="set-group-title">{title}</h2> : null}
      <div className="set-card">{children}</div>
    </section>
  );
}

export function SettingsRow({
  icon,
  label,
  sub,
  trailing,
  onClick,
  danger,
  tone,
}: {
  /** شناسه آیکون در sprite، بدون # */
  icon: string;
  label: string;
  sub?: string;
  trailing: RowTrailing;
  onClick?: () => void;
  /** ردیف هشدار — آیکون و متن قرمز */
  danger?: boolean;
  /** آیکون رنگی به‌جای تک‌رنگ — فقط برای ردیف تشویقی «ارتقا» */
  tone?: "gold";
}) {
  const body = (
    <>
      <span className="set-row-ico">
        <svg>
          <use href={`#i-${icon}`} />
        </svg>
      </span>
      <span className="set-row-body">
        <span className="set-row-label">{label}</span>
        {sub ? <span className="set-row-sub">{sub}</span> : null}
      </span>
      <span className="set-row-trail">{renderTrailing(trailing)}</span>
    </>
  );

  const cls = `set-row${danger ? " danger" : ""}${tone === "gold" ? " gold" : ""}`;

  if (trailing.type === "toggle") {
    return (
      <button
        type="button"
        className={cls}
        role="switch"
        aria-checked={trailing.on}
        onClick={() => trailing.onChange(!trailing.on)}
      >
        {body}
      </button>
    );
  }

  if (trailing.type === "stepper") {
    /* دکمه‌های بالا/پایین داخل ردیف‌اند، پس خود ردیف دکمه نیست */
    return <div className={cls}>{body}</div>;
  }

  if (!onClick) return <div className={cls}>{body}</div>;

  return (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  );
}

function renderTrailing(t: RowTrailing): ReactNode {
  switch (t.type) {
    case "counter":
      return (
        <>
          <span className="set-count">{toFa(t.count)}</span>
          <Chevron />
        </>
      );

    case "value":
      return (
        <>
          <span className="set-value">{t.value}</span>
          <Chevron />
        </>
      );

    case "action":
      return <span className="set-action">{t.label}</span>;

    case "toggle":
      return (
        <span className={`set-switch${t.on ? " on" : ""}`}>
          <span className="set-switch-knob" />
        </span>
      );

    case "stepper":
      return (
        <>
          <span className="set-value">{t.value}</span>
          <span className="set-stepper">
            <button
              type="button"
              className="set-step-btn"
              aria-label="گزینه بعدی"
              disabled={t.canUp === false}
              onClick={() => t.onStep(1)}
            >
              <svg>
                <use href="#i-arrow-l" />
              </svg>
            </button>
            <button
              type="button"
              className="set-step-btn down"
              aria-label="گزینه قبلی"
              disabled={t.canDown === false}
              onClick={() => t.onStep(-1)}
            >
              <svg>
                <use href="#i-arrow-l" />
              </svg>
            </button>
          </span>
        </>
      );

    case "chevron":
    default:
      return <Chevron />;
  }
}

/* RTL: حرکت رو به جلو یعنی به سمت چپ — پس همیشه فلش چپ */
function Chevron() {
  return (
    <svg className="set-chev">
      <use href="#i-arrow-l" />
    </svg>
  );
}
