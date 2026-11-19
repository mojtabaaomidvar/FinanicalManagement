import { useRef, type ReactNode } from "react";
import type { Route } from "@/app/router";
import type { HomeGroupId, HomePreferences } from "@/domain/home/homePreferences.types";
import { HOME_GROUPS } from "@/domain/home/homePreferences.rules";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { ACTIVE_MODULES, type HubModule } from "./modules";
import "./HomeModules.css";

const byId = new Map(ACTIVE_MODULES.map(module => [module.id, module]));
const groupById = new Map(HOME_GROUPS.map(group => [group.id, group]));
const groupStyle: Record<HomeGroupId, { tone: string; icon: string }> = {
  money: { tone: "emerald", icon: "i-wallet" }, daily: { tone: "amber", icon: "i-check" },
  belongings: { tone: "indigo", icon: "i-briefcase" }, family: { tone: "rose", icon: "i-users" },
};
function PinIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 3 6 0-1 7 4 4H6l4-4-1-7ZM12 14v7" />
  </svg>;
}
export function HomeModules({ preferences, onChange, disabled, subtitle, onNav, children, view,
  saving, pending, conflict, error, restricted, onRetry }: {
  preferences: HomePreferences; onChange: (next: HomePreferences) => void; disabled: boolean;
  subtitle: (module: HubModule) => string | undefined; onNav: (route: Route) => void;
  children: ReactNode; view: "dashboard" | "sections"; saving: boolean; pending: boolean;
  conflict: boolean; error: string | null; restricted: boolean; onRetry: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  function pin(module: HubModule) {
    const pinned = preferences.pins.includes(module.id);
    return <button type="button" className="home-pin-button" data-pin-module={module.id} disabled={disabled}
      aria-pressed={pinned} aria-label={`${pinned ? "برداشتن پین" : "پین در بالا"} ${module.title}`}
      title={pinned ? "برداشتن پین" : "پین در بالا"}
      onClick={event => {
        const removedShortcut = pinned && Boolean(event.currentTarget.closest("[data-shortcut-id]"));
        if (!disabled) onChange({ ...preferences,
          pins: pinned ? preferences.pins.filter(id => id !== module.id) : [...preferences.pins, module.id] });
        if (removedShortcut) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("#home-quick-title")?.focus({ preventScroll: true }));
      }}><PinIcon /></button>;
  }
  function moduleIcon(module: HubModule) {
    return module.icon ? <span className="hub-tile-ic" aria-hidden="true"><Icon name={module.icon} size={20} /></span> : null;
  }
  function tile(id: string) {
    const module = byId.get(id)!;
    return <article key={id} className={`home-module-tile tone-${module.tone}`} data-module-id={id}>
      <button type="button" className="home-module-main" data-home-module={id} data-open-module={id}
        aria-label={`بازکردن ${module.title}`} onClick={() => module.route && onNav(module.route)}>
        <span className="home-module-top">{moduleIcon(module)}<b>{module.title}</b></span>
        <span className="home-module-sub hub-tile-sub">{subtitle(module)}</span>
      </button>
      {pin(module)}
    </article>;
  }
  return <div className="home-modules" ref={root}>
    {view === "dashboard" ? <section className="home-quick-access" aria-labelledby="home-quick-title">
      <div className="home-section-head"><h2 id="home-quick-title" tabIndex={-1}>دسترسی سریع</h2>
        <button type="button" className="home-text-button" onClick={() => onNav("sections")}>همهٔ بخش‌ها<Icon name="i-arrow-l" size={15} /></button>
      </div>
      <div className="home-quick-grid" data-home-pins>
        {preferences.pins.map(id => {
          const module = byId.get(id)!;
          return <article key={id} className={`home-shortcut tone-${module.tone}`} data-shortcut-id={id}>
            <button type="button" className="home-shortcut-main" data-home-shortcut={id} data-open-module={id}
              aria-label={`بازکردن ${module.title}`} onClick={() => module.route && onNav(module.route)}>
              {moduleIcon(module)}<b>{module.title}</b></button>{pin(module)}
          </article>;
        })}
      </div>
      {!preferences.pins.length ? <p className="home-quick-empty"><PinIcon />از بخش‌های خانه، کاشی دلخواهت را پین کن.</p> : null}
    </section> : <section className="home-catalog" aria-label="بخش‌های دسته‌بندی‌شدهٔ خانه">
      {preferences.groupOrder.map(id => {
        const groupId = id as HomeGroupId, group = groupById.get(groupId)!, ids = preferences.groupModules[groupId], style = groupStyle[groupId];
        return <section key={id} className={`home-group tone-${style.tone}`} data-home-group={id} aria-labelledby={`home-group-${id}`}>
          <header className="home-group-head">
            <span className="hub-tile-ic" aria-hidden="true"><Icon name={style.icon} size={20} /></span>
            <h2 id={`home-group-${id}`}>{group.title}</h2><span className="home-group-count">{toFa(ids.length)} بخش</span>
          </header>
          <div className="home-group-grid">{ids.length ? ids.map(tile) : <p className="home-empty-group">بخشی در این دسته نیست.</p>}</div>
        </section>;
      })}
    </section>}
    <div className="home-preferences-status" role={error ? "alert" : "status"}>
      {error ? <>{error}<button type="button" className="home-text-button" onClick={onRetry}>{conflict ? "دریافت تنظیمات تازه" : "تلاش دوباره"}</button></>
        : saving ? "در حال ذخیرهٔ دسترسی‌های شخصی…" : pending ? "تغییرها پس از اتصال ذخیره می‌شوند."
          : restricted ? "دسترسی‌های شخصی در این دستگاه نگه داشته می‌شوند." : null}
    </div>
    {view === "dashboard" ? children : null}
  </div>;
}
