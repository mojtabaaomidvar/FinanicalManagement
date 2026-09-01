/* پوسته زیرصفحه تنظیمات — هدر با دکمه بازگشت + انیمیشن ورود */

import type { ReactNode } from "react";

export function SettingsSubPage({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <section className="page active">
      <header className="app-header">
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}
        >
          <button
            type="button"
            className="icon-btn"
            aria-label="بازگشت"
            onClick={onBack}
          >
            <svg>
              <use href="#i-arrow-r" />
            </svg>
          </button>
          <div className="header-title">
            <h1>{title}</h1>
          </div>
        </div>
      </header>
      <div className="content page-anim">{children}</div>
    </section>
  );
}
