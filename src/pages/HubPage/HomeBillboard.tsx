import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TxType } from "@/domain/transaction/transaction.types";
import { currencyDisplayLabel } from "@/shared/lib/uiLabels";
import { formatSignedAmount } from "@/shared/lib/format";
import { toDisplay } from "@/shared/lib/currency";
import { toFa } from "@/shared/lib/digits";
import { Icon } from "@/shared/ui";
import { HomeBillboardArt, type BillboardSection } from "./HomeBillboardArt";
import "./HomeBillboard.css";

const sections: { id: BillboardSection; label: string; icon: string }[] = [
  { id: "transaction", label: "ثبت تراکنش", icon: "i-receipt" },
  { id: "wallets", label: "کیف‌پول‌ها", icon: "i-wallet" },
  { id: "budget", label: "بودجه", icon: "i-piggy" },
  { id: "dues", label: "موعدها", icon: "i-clock" },
];

export function HomeBillboard({ wallets, budget, dues, currency, loading, incomplete, offline,
  onTransaction, onAccounts, onBudgets, onDues, onRetry }: {
  wallets: { count: number; balance: number }; budget: { limit: number; spent: number };
  dues: { overdue: number; today: number; upcoming: number }; currency: string;
  loading: boolean; incomplete: boolean; offline: boolean;
  onTransaction: (type: TxType) => void; onAccounts: () => void; onBudgets: () => void;
  onDues: () => void; onRetry: () => void;
}) {
  const deck = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const gesture = useRef<{ id: number; x: number; y: number; started: number; dx: number; horizontal: boolean } | null>(null);
  const [motion, setMotion] = useState({ index: 0, offset: 0, direction: 1, phase: "idle" });
  const current = useRef(motion); current.current = motion;
  const [reduced, setReduced] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [covered, setCovered] = useState(false), [hidden, setHidden] = useState(document.hidden);
  const unavailable = loading || incomplete || offline;
  const dueCount = dues.overdue + dues.today + dues.upcoming;
  const budgetUsage = budget.limit > 0 ? Math.round(budget.spent / budget.limit * 100) : 0;
  const wrap = (index: number) => (index + sections.length) % sections.length;
  const width = deck.current?.clientWidth || 360;
  const progress = Math.min(1, Math.abs(motion.offset) / width);
  const underneath = wrap(motion.index + motion.direction);
  const settle = useCallback((direction: number, commit: boolean) => {
    if (current.current.phase === "settling") return;
    const index = current.current.index;
    clearTimeout(timer.current);
    if (reduced) { setMotion({ index: commit ? wrap(index + direction) : index, direction, offset: 0, phase: "idle" }); return; }
    setMotion({ index, direction, offset: commit ? direction * ((deck.current?.clientWidth || 360) + 36) : 0, phase: "settling" });
    timer.current = setTimeout(() => {
      setMotion({ index: commit ? wrap(index + direction) : index, direction, offset: 0, phase: "idle" });
    }, 300);
  }, [reduced]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => { setReduced(media.matches); if (media.matches) setPaused(true); };
    const visibility = () => setHidden(document.hidden);
    const overlays = () => setCovered(Boolean(document.querySelector(".modal-overlay, .dp-overlay, dialog[open]")));
    const observer = new MutationObserver(overlays);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open", "class"] });
    overlays(); media.addEventListener("change", change); document.addEventListener("visibilitychange", visibility);
    return () => { observer.disconnect(); media.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility); clearTimeout(timer.current); };
  }, []);
  useEffect(() => {
    if (paused || hovered || focused || hidden || covered || motion.phase !== "idle") return;
    const autoplay = setTimeout(() => settle(1, true), 6000);
    return () => clearTimeout(autoplay);
  }, [paused, hovered, focused, hidden, covered, motion.index, motion.phase, settle]);
  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (motion.phase !== "idle") return;
    if (event.key === "Home" || event.key === "End") setMotion({ index: event.key === "Home" ? 0 : sections.length - 1, direction: 1, offset: 0, phase: "idle" });
    else settle(event.key === "ArrowLeft" ? 1 : -1, true);
  }
  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0 || current.current.phase !== "idle"
      || (event.target as Element).closest("button, a, input")) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now(), dx: 0, horizontal: false };
  }
  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture.current = null; return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.15) return;
      start.horizontal = true; event.currentTarget.setPointerCapture(event.pointerId);
    }
    start.dx = dx;
    setMotion({ index: current.current.index, offset: dx, direction: dx >= 0 ? 1 : -1, phase: "dragging" });
  }
  function finishPointer(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!start.horizontal) return;
    const direction = start.dx >= 0 ? 1 : -1, distance = Math.abs(start.dx);
    const velocity = distance / Math.max(1, performance.now() - start.started);
    settle(direction, !cancelled && (distance > width * .22 || distance > 35 && velocity > .5));
  }
  function amount(value: number) {
    return <span className="home-billboard-amount"><bdi>{formatSignedAmount(toDisplay(value, currency))}</bdi>
      <small>{currencyDisplayLabel(currency)}</small></span>;
  }
  return <section className="home-billboard" aria-label="دسترسی‌های مهم خانه" aria-roledescription="نمایش کارت‌های خانه">
    <div ref={deck} className="home-billboard-deck" tabIndex={0} data-billboard-active={sections[motion.index].id}
      data-billboard-phase={motion.phase} onKeyDown={handleKey}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)}
      onLostPointerCapture={event => finishPointer(event, true)}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      {sections.map((section, index) => {
        const active = section.id, front = index === motion.index, behind = index === underneath;
        return <div key={active} className={`home-billboard-stage is-${active}`} data-billboard-card={active}
          data-billboard-layer={front ? "front" : behind ? "underneath" : "hidden"} role="group"
          aria-label={section.label} aria-hidden={!front} ref={element => element?.toggleAttribute("inert", !front)}
          style={{ zIndex: front ? 2 : behind ? 1 : 0, visibility: front || behind ? "visible" : "hidden",
            pointerEvents: front && motion.phase === "idle" ? "auto" : "none",
            transform: front ? `translateX(${motion.offset}px) rotate(${motion.offset / width * 4}deg)`
              : `translate(${-motion.direction * 14 * (1 - progress)}px, ${8 * (1 - progress)}px) scale(${.96 + .04 * progress})`,
            filter: front ? "none" : `blur(${7 * (1 - progress)}px)`, opacity: front ? 1 : .7 + .3 * progress,
            transition: motion.phase === "settling" ? "transform 300ms cubic-bezier(.22,.7,.2,1), filter 300ms ease, opacity 300ms ease" : "none" }}>
      <div className="home-billboard-composition">
        <div className="home-billboard-copy">
          <p className="home-billboard-eyebrow"><Icon name={section.icon} size={15} />
            {active === "transaction" ? "یک ثبت، یک خیال راحت" : active === "wallets" ? "پول نقد، زیر نظر تو"
              : active === "budget" ? "برای خرج‌های مهم جا بگذار" : "یک نگاه، قبل از شروع روز"}
          </p>
          {active === "transaction" ? <>
            <h2>خرج و درآمدت را<br />همان لحظه <span className="home-billboard-keep">ثبت کن</span></h2>
            <p className="home-billboard-description">از حساب بانکی یا کیف‌پول نقدی؛ هر پرداخت و دریافت را ثبت کن.</p>
          </> : active === "wallets" ? <>
            <h2>موجودی کیف‌پول‌های من</h2>
            {!unavailable ? <>
              {amount(wallets.balance)}
              <p className="home-billboard-description">{wallets.count
                ? /* @copy-text home.billboard.wallet_count */ `${toFa(wallets.count)} کیف‌پول نقدی، با موجودی به‌روز`
                : "کیف‌پول نقدی خودت را بساز و پول نقدت را هم حساب کن."}</p>
            </> : null}
          </> : active === "budget" ? <>
            <h2>{unavailable ? "بودجهٔ این ماه" : budget.limit ? budget.spent > budget.limit ? "خرج از سقف بودجه گذشته"
              : budgetUsage >= 80 ? "بودجه به سقف نزدیک است" : "بودجهٔ باقی‌ماندهٔ این ماه" : "برای خرج ماه سقف بگذار"}</h2>
            {!unavailable && budget.limit > 0 ? <>
              {amount(Math.max(0, budget.limit - budget.spent))}
              <progress className="home-billboard-progress" aria-label="مصرف بودجهٔ دسته‌ها"
                max={budget.limit} value={Math.min(budget.spent, budget.limit)} />
              <p className="home-billboard-description">{/* @copy-text home.billboard.budget_usage */ `${toFa(budgetUsage)}٪ از بودجهٔ دسته‌ها مصرف شده است.`}</p>
            </> : !unavailable ? <p className="home-billboard-description">برای دسته‌های هزینه بودجه تعیین کن و مصرف این ماه را ببین.</p> : null}
          </> : <>
            <h2>موعدها را از قلم نینداز</h2>
            {!loading && !incomplete ? <>
              <p className="home-billboard-due-count"><b>{toFa(dueCount)}</b><span>موعد در انتظار رسیدگی</span></p>
              <p className="home-billboard-description">{dueCount
                ? /* @copy-text home.billboard.due_summary */ `${toFa(dues.overdue)} عقب‌افتاده · ${toFa(dues.today)} امروز · ${toFa(dues.upcoming)} فردا`
                : offline ? "در داده‌های آفلاین، کاری برای این بازه موعد ندارد." : "برای امروز و فردا، موعدی در انتظار نیست."}</p>
            </> : null}
          </>}
        </div>
        <HomeBillboardArt section={active} />
      </div>
      {unavailable ? <div className="home-billboard-status" role="status">
        <span>{offline ? active === "dues" ? "موعدهای آفلاین شامل کارهای خانه است." : "اطلاعات مالی با اتصال به اینترنت در دسترس است."
          : loading ? "در حال دریافت اطلاعات خانه…" : "بخشی از اطلاعات خانه دریافت نشد."}</span>
        {!offline && !loading && incomplete ? <button type="button" onClick={onRetry}>تلاش دوباره</button> : null}
      </div> : null}
      <div className="home-billboard-actions">
        {active === "transaction" ? <>
          <button type="button" className="home-billboard-primary" disabled={offline} onClick={() => onTransaction("expense")}>
            <Icon name="i-plus" size={18} />ثبت هزینه</button>
          <button type="button" className="home-billboard-secondary" disabled={offline} onClick={() => onTransaction("income")}>ثبت درآمد</button>
          <button type="button" className="home-billboard-transfer" disabled={offline} onClick={() => onTransaction("transfer")}>
            <Icon name="i-swap" size={18} /><span>انتقال</span></button>
        </> : <button type="button" className="home-billboard-primary" disabled={offline && active !== "dues"}
          onClick={active === "wallets" ? onAccounts : active === "budget" ? onBudgets : onDues}>
          {active === "wallets" ? unavailable || wallets.count ? "مشاهدهٔ کیف‌پول‌ها" : "ساخت کیف‌پول نقدی"
            : active === "budget" ? "مشاهدهٔ بودجه‌ها" : "مشاهدهٔ موعدها"}<Icon name="i-arrow-l" size={17} /></button>}
      </div>
        </div>;
      })}
      <div className="home-billboard-controls">
        <button type="button" className="home-billboard-play" aria-label={paused ? "شروع نمایش خودکار کارت‌ها" : "توقف نمایش خودکار کارت‌ها"}
          aria-pressed={paused} onClick={() => setPaused(value => !value)}>
          <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            {paused ? <path d="m6 3 11 7-11 7Z" /> : <path d="M5 3h3v14H5zm7 0h3v14h-3z" />}
          </svg>
        </button>
        <span className="home-billboard-dots" aria-hidden="true">{sections.map((section, index) =>
          <i key={section.id} className={index === motion.index ? "is-active" : undefined} />)}</span>
      </div>
    </div>
  </section>;
}
