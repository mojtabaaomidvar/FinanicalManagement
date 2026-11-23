import { toFa } from "@/shared/lib/digits";
import { AssistantSparkle } from "@/features/household-assistant/ui/HouseholdAssistant";
import "./FloatingNavigation.css";

export function FloatingNavigation({ home, sections, onHome, onSections, onNotifications, notifications, count, hidden, onAssistant }: {
  home: boolean; sections: boolean; notifications: boolean; onHome: () => void; onSections: () => void;
  onNotifications: () => void; count: number; hidden: boolean;
  onAssistant: () => void;
}) {
  return !hidden ? <div className="floating-access">
    <nav className="floating-navigation" aria-label="دسترسی سریع">
      <button type="button" aria-current={home ? "page" : undefined} onClick={onHome}><svg><use href="#i-home" /></svg><span>داشبورد</span></button>
      <button type="button" aria-current={sections ? "page" : undefined} onClick={onSections}><svg><use href="#i-grid4" /></svg><span>بخش‌های خانه</span></button>
      <button type="button" aria-current={notifications ? "page" : undefined} onClick={onNotifications}><span className="floating-bell"><svg><use href="#i-bell" /></svg>
        {count > 0 ? <b>{toFa(count)}</b> : null}</span><span>اعلان‌ها</span></button>
    </nav>
    <button type="button" className="floating-assistant" aria-label="بازکردن دستیار خانه‌یار" onClick={onAssistant}>
      <AssistantSparkle /><span>دستیار</span>
    </button>
  </div> : null;
}
