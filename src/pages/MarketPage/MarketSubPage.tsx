/* پوسته‌ی زیرصفحه‌ی بازار — هدر با دکمه‌ی بازگشت + انیمیشن ورود.

   چرا کپیِ SettingsSubPage است و از آن import نمی‌شود: هر دو در لایه‌ی pages
   هستند و import از pages به pages وابستگیِ افقی می‌سازد. اگر روزی سومی هم
   لازم شد، وقتش است که این پوسته به shared/ui برود. */

import type { ReactNode } from "react";
import { Icon } from "@/shared/ui";

export function MarketSubPage({
  title,
  onBack,
  action,
  children,
}: {
  title: string;
  onBack: () => void;
  /** گوشه‌ی چپِ هدر — مثلاً دکمه‌ی به‌روزرسانی */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page active">
      <header className="app-header">
        <div className="market-sub-head">
          <button
            type="button"
            className="icon-btn"
            aria-label="بازگشت"
            onClick={onBack}
          >
            {/* در RTL فلشِ بازگشت به راست است */}
            <Icon name="i-arrow-r" size={20} />
          </button>
          <div className="header-title">
            <h1>{title}</h1>
          </div>
        </div>
        {action}
      </header>
      <div className="content page-anim">{children}</div>
    </section>
  );
}
