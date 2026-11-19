import { toFa } from "@/shared/lib/digits";
import "./FloatingNavigation.css";

export function FloatingNavigation({ home, sections, onHome, onSections, onNotifications, count, hidden }: {
  home: boolean; sections: boolean; onHome: () => void; onSections: () => void;
  onNotifications: () => void; count: number; hidden: boolean;
}) {
  return !hidden ? <nav className="floating-navigation" aria-label="دسترسی سریع">
      <button type="button" aria-current={home ? "page" : undefined} onClick={onHome}><svg><use href="#i-home" /></svg><span>داشبورد</span></button>
      <button type="button" aria-current={sections ? "page" : undefined} onClick={onSections}><svg><use href="#i-grid4" /></svg><span>بخش‌های خانه</span></button>
      <button type="button" onClick={onNotifications}><span className="floating-bell"><svg><use href="#i-bell" /></svg>
        {count > 0 ? <b>{toFa(count)}</b> : null}</span><span>اعلان‌ها</span></button>
    </nav> : null;
}
