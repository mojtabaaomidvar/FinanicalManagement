import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toFa } from "@/shared/lib/digits";
import { AssistantSparkle } from "@/features/household-assistant/ui/HouseholdAssistant";
import "./FloatingNavigation.css";
import { useBackGuard } from "@/shared/lib/useBackGuard";

export type QuickAddKind = "expense" | "income" | "transfer" | "shopping" | "task" | "activity" | "meal";

const QUICK_ITEMS: { kind: QuickAddKind; icon: string; label: string }[] = [
  { kind: "shopping", icon: "i-cart", label: "قلم خرید" },
  { kind: "task", icon: "i-check", label: "کار خانه" },
  { kind: "activity", icon: "i-calendar", label: "رویداد خانوادگی" },
  { kind: "meal", icon: "i-food", label: "وعدهٔ غذایی" },
];

export function FloatingNavigation({ home, sections, onHome, onSections, onNotifications, notifications, count, hidden, onAssistant, onQuickAdd }: {
  home: boolean; sections: boolean; notifications: boolean; onHome: () => void; onSections: () => void;
  onNotifications: () => void; count: number; hidden: boolean;
  onAssistant: () => void;
  onQuickAdd: (kind: QuickAddKind) => void;
}) {
  const accessRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useBackGuard(menuOpen, () => closeMenu(true));
  useBackGuard(menuOpen && financeOpen, () => setFinanceOpen(false));
  useEffect(() => { if (hidden) closeMenu(); }, [hidden]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accessRef.current?.contains(event.target)) {
        setMenuOpen(false);
        setFinanceOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    accessRef.current?.querySelector<HTMLButtonElement>(".quick-add-menu button")?.focus();
  }, [menuOpen, financeOpen]);

  useEffect(() => {
    const onScroll = (event?: Event) => {
      const scroller = document.querySelector('.page-visit:not([hidden]) .page-scroll');
      if (event && event.target !== document && event.target !== scroller) return;
      const next = (scroller?.scrollTop ?? window.scrollY) > 32;
      setCollapsed(next);
      if (next) { setMenuOpen(false); setFinanceOpen(false); }
    };
    onScroll();
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [home, sections, notifications]);

  function closeMenu(restoreFocus = false) {
    setMenuOpen(false);
    setFinanceOpen(false);
    if (restoreFocus) requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  function runQuickAdd(kind: QuickAddKind) {
    addButtonRef.current?.focus();
    closeMenu(false);
    onQuickAdd(kind);
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (financeOpen) { setFinanceOpen(false); return; }
      closeMenu(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = [...(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? (index + 1 + buttons.length) % buttons.length
        : (index - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return <div className="floating-access" hidden={hidden}>
    <div className="floating-access-controls">
    <nav className="floating-navigation" aria-label="دسترسی سریع">
      <button type="button" aria-current={home ? "page" : undefined} onClick={onHome}><svg><use href="#i-home" /></svg><span>داشبورد</span></button>
      <button type="button" aria-current={sections ? "page" : undefined} onClick={onSections}><svg><use href="#i-grid4" /></svg><span>بخش‌های خانه</span></button>
      <button type="button" aria-current={notifications ? "page" : undefined} onClick={onNotifications}><span className="floating-bell"><svg><use href="#i-bell" /></svg>
        {count > 0 ? <b>{toFa(count)}</b> : null}</span><span>اعلان‌ها</span></button>
    </nav>
    <button type="button" className="floating-assistant" aria-label="بازکردن دستیار خانه‌یار" onClick={onAssistant}>
      <AssistantSparkle /><span>دستیار</span>
    </button>
    <div ref={accessRef} className="floating-quick-zone">
    <button ref={addButtonRef} type="button" className={`floating-quick-add${collapsed ? " is-collapsed" : ""}`}
      aria-label="افزودن سریع" aria-haspopup="true" aria-expanded={menuOpen}
      aria-controls="quick-add-menu" onClick={() => menuOpen ? closeMenu(true) : setMenuOpen(true)}>
      <svg aria-hidden="true"><use href="#i-plus" /></svg><span aria-hidden="true">افزودن</span>
    </button>
    {menuOpen ? <div id="quick-add-menu" className="quick-add-menu" role="group"
      aria-label={financeOpen ? "نوع تراکنش مالی" : "گزینه‌های افزودن سریع"} onKeyDown={handleMenuKeyDown}>
      {financeOpen ? <>
        <button type="button" className="quick-add-back" onClick={() => setFinanceOpen(false)}>
          <svg aria-hidden="true"><use href="#i-arrow-r" /></svg><span>بازگشت به افزودن</span>
        </button>
        <p className="quick-add-heading">تراکنش مالی</p>
        <button type="button" className="quick-add-item" onClick={() => runQuickAdd("expense")}>
          <svg aria-hidden="true"><use href="#i-bill" /></svg><span>هزینه</span>
        </button>
        <button type="button" className="quick-add-item" onClick={() => runQuickAdd("income")}>
          <svg aria-hidden="true"><use href="#i-arrow-l" /></svg><span>درآمد</span>
        </button>
        <button type="button" className="quick-add-item" onClick={() => runQuickAdd("transfer")}>
          <svg aria-hidden="true"><use href="#i-repeat" /></svg><span>انتقال</span>
        </button>
      </> : <>
        <p className="quick-add-heading">چه چیزی اضافه می‌کنید؟</p>
        <button type="button" className="quick-add-item" aria-haspopup="true" aria-expanded={financeOpen}
          onClick={() => setFinanceOpen(true)}>
          <svg aria-hidden="true"><use href="#i-wallet" /></svg><span>تراکنش مالی</span>
          <svg className="quick-add-arrow" aria-hidden="true"><use href="#i-arrow-l" /></svg>
        </button>
        {QUICK_ITEMS.map(item => <button key={item.kind} type="button" className="quick-add-item"
          onClick={() => runQuickAdd(item.kind)}>
          <svg aria-hidden="true"><use href={`#${item.icon}`} /></svg><span>{item.label}</span>
          <svg className="quick-add-arrow" aria-hidden="true"><use href="#i-arrow-l" /></svg>
        </button>)}
      </>}
    </div> : null}
    </div>
    </div>
  </div>;
}
