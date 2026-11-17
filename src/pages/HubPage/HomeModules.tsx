import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Route } from "@/app/router";
import type { HomeGroupId, HomePreferences } from "@/domain/home/homePreferences.types";
import { HOME_GROUPS, homeModuleGroup, moveHomeModule, reorderHomeItem } from "@/domain/home/homePreferences.rules";
import { Icon } from "@/shared/ui";
import { toFa } from "@/shared/lib/digits";
import { ACTIVE_MODULES, type HubModule } from "./modules";
import { useHomeDrag, type HomeDragKind } from "./useHomeDrag";
import "./HomeModules.css";

const byId = new Map(ACTIVE_MODULES.map((module) => [module.id, module]));
const groupById = new Map(HOME_GROUPS.map((group) => [group.id, group]));
const groupStyle: Record<HomeGroupId, { tone: string; icon?: string }> = {
  money: { tone: "emerald", icon: "i-wallet" }, daily: { tone: "amber", icon: "i-check" },
  belongings: { tone: "indigo", icon: "i-briefcase" }, family: { tone: "rose", icon: "i-users" },
};

function GripIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[7, 12, 17].flatMap((y) => [9, 15].map((x) => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.5" />))}
  </svg>;
}
function PinIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 3 6 0-1 7 4 4H6l4-4-1-7ZM12 14v7" />
  </svg>;
}
function PositionIcon() {
  return null;
}

export function HomeModules({ preferences, onChange, disabled, lifecycleKey, subtitle, onNav, children,
  saving, pending, conflict, error, restricted, onRetry, onReset }: {
  preferences: HomePreferences; onChange: (next: HomePreferences) => void; disabled: boolean;
  lifecycleKey: string; subtitle: (module: HubModule) => string | undefined; onNav: (route: Route) => void;
  children: ReactNode; saving: boolean; pending: boolean; conflict: boolean; error: string | null;
  restricted: boolean; onRetry: () => void; onReset: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [arrange, setArrange] = useState<{ kind: HomeDragKind; id: string } | "settings" | null>(null);
  const { display, announcement, dragging, cancel } = useHomeDrag({ root, preferences, onChange, disabled, lifecycleKey });

  function closeDialog() {
    dialog.current?.close(); setArrange(null);
    requestAnimationFrame(() => {
      if (typeof arrange === "object" && arrange) {
        root.current?.querySelector<HTMLButtonElement>(`[data-home-arrange="${arrange.kind}"][data-arrange-id="${arrange.id}"]`)?.focus({ preventScroll: true });
      } else opener.current?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (arrange && !dialog.current?.open) dialog.current?.showModal();
  }, [arrange]);
  useEffect(() => { dialog.current?.close(); setArrange(null); }, [disabled, lifecycleKey]);

  function openArrange(kind: HomeDragKind | "settings", id: string, button: HTMLButtonElement) {
    if (disabled || dragging()) return;
    cancel(); opener.current = button; setArrange(kind === "settings" ? "settings" : { kind, id });
  }
  function commit(next: HomePreferences) { if (!disabled && !dragging()) onChange(next); }
  function pin(module: HubModule) {
    const pinned = display.pins.includes(module.id);
    return <button type="button" className="home-pin-button" data-pin-module={module.id} disabled={disabled}
      aria-pressed={pinned} aria-label={`${pinned ? "برداشتن پین" : "پین در بالا"} ${module.title}`}
      title={pinned ? "برداشتن پین" : "پین در بالا"}
      onClick={(event) => {
        const removedShortcut = pinned && Boolean(event.currentTarget.closest("[data-shortcut-id]"));
        commit({ ...display, pins: pinned ? display.pins.filter((id) => id !== module.id) : [...display.pins, module.id] });
        if (removedShortcut) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("#home-quick-title")?.focus({ preventScroll: true }));
      }}>
      <PinIcon />
    </button>;
  }
  function handle(kind: HomeDragKind, id: string, title: string) {
    return <button type="button" className="home-drag-handle" data-home-drag={kind} data-drag-id={id}
      {...{ [`data-drag-${kind}`]: id }} aria-pressed="false" aria-describedby="home-drag-instructions"
      aria-label={`جابه‌جایی ${title}`} title="بکش و جابه‌جا کن" disabled={disabled}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}><GripIcon /></button>;
  }
  function position(kind: HomeDragKind, id: string, title: string) {
    return <button type="button" className="home-arrange-button" data-home-arrange={kind} data-arrange-id={id}
      disabled={disabled} aria-label={`تنظیم جایگاه ${title}`} title="تنظیم جایگاه"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); openArrange(kind, id, event.currentTarget); }}><PositionIcon /></button>;
  }
  function moduleIcon(module: HubModule) {
    if (!module.icon) return null;
    return <span className="hub-tile-ic" aria-hidden="true"><Icon name={module.icon} size={21} /></span>;
  }
  function tile(id: string) {
    const module = byId.get(id)!;
    return <article key={id} className={`home-module-tile tone-${module.tone}`} data-module-id={id}>
      <button type="button" className="home-module-main" data-home-module={id} data-open-module={id}
        aria-label={`بازکردن ${module.title}`} onClick={() => module.route && onNav(module.route)}>
        <span className="home-module-top"><b>{module.title}</b>{moduleIcon(module)}</span>
        <span className="home-module-sub hub-tile-sub">{subtitle(module)}</span>
      </button>
      <div className="home-module-footer">
        <span className="home-pin-label">{display.pins.includes(id) ? "پین‌شده" : ""}</span>
        <div className="home-module-tools">{pin(module)}{position("module", id, module.title)}{handle("module", id, module.title)}</div>
      </div>
    </article>;
  }
  const arrangeItem = arrange && typeof arrange === "object" ? arrange : null;
  const arrangeGroup = arrangeItem?.kind === "module" ? homeModuleGroup(display, arrangeItem.id) : undefined;
  const arrangeList = !arrangeItem ? [] : arrangeItem.kind === "pin" ? display.pins : arrangeItem.kind === "group" ? display.groupOrder
    : display.layout === "flat" ? display.flatOrder : display.groupModules[arrangeGroup!];
  const arrangeIndex = arrangeItem ? arrangeList.indexOf(arrangeItem.id) : -1;
  const arrangeTitle = arrangeItem ? arrangeItem.kind === "group" ? groupById.get(arrangeItem.id as HomeGroupId)!.title : byId.get(arrangeItem.id)!.title : /* @copy-text src/pages/HubPage/HomeModules.tsx:109:typescript-string */ "چیدمان";
  function step(direction: number) {
    if (!arrangeItem) return;
    const nextIndex = arrangeIndex + direction;
    if (nextIndex < 0 || nextIndex >= arrangeList.length) return;
    const order = reorderHomeItem(arrangeList, arrangeItem.id, nextIndex);
    commit(arrangeItem.kind === "pin" ? { ...display, pins: order } : arrangeItem.kind === "group" ? { ...display, groupOrder: order }
      : display.layout === "flat" ? { ...display, flatOrder: order } : moveHomeModule(display, arrangeItem.id, arrangeGroup!, nextIndex));
  }

  return <div className="home-modules" ref={root}>
    <section className="home-quick-access" data-drop-pins aria-labelledby="home-quick-title">
      <div className="home-section-head">
        <h2 id="home-quick-title" tabIndex={-1}>دسترسی سریع</h2>
        <button type="button" className="home-text-button" disabled={disabled}
          onClick={(event) => openArrange("settings", "", event.currentTarget)}>{/* @copy-text src/pages/HubPage/HomeModules.tsx:127:jsx-text jsx-body */ "چیدمان\n"}</button>
      </div>
      <div className="home-quick-grid" data-home-pins>
        {display.pins.map((id) => {
          const module = byId.get(id)!;
          return <article key={id} className={`home-shortcut tone-${module.tone}`} data-shortcut-id={id}>
            <button type="button" className="home-shortcut-main" data-home-shortcut={id} data-open-module={id} aria-label={`بازکردن ${module.title}`}
              onClick={() => module.route && onNav(module.route)}>{moduleIcon(module)}<b>{module.title}</b></button>
            {pin(module)}<div className="home-shortcut-tools">{position("pin", id, module.title)}{handle("pin", id, module.title)}</div>
          </article>;
        })}
      </div>
      {!display.pins.length ? <p className="home-quick-empty"><PinIcon />کاشی دلخواهت را پین کن یا به اینجا بکش.</p> : null}
      <div className="home-preferences-status" role={error ? "alert" : "status"}>
        {error ? <>{error}<button type="button" className="home-text-button" onClick={onRetry}>{conflict ? "ذخیرهٔ چیدمان من" : "تلاش دوباره"}</button></>
          : disabled ? "در حال دریافت چیدمان…"
          : saving ? "در حال ذخیرهٔ چیدمان…" : pending && restricted ? "چیدمان روی این دستگاه ذخیره شد؛ پس از اتصال با حسابت همگام می‌شود." : null}
      </div>
    </section>

    {children}

    <section className="home-catalog" aria-labelledby="home-catalog-title">
      <h2 id="home-catalog-title" className="home-catalog-title">{display.layout === "grouped" ? "بخش‌های خانه" : "همهٔ کاشی‌های خانه"}</h2>
      <p className="home-drag-instructions" id="home-drag-instructions">با دستگیرهٔ شش‌نقطه‌ای، کاشی‌ها و دسته‌ها را به جای دلخواه بکش.
        <span className="home-keyboard-instructions">با صفحه‌کلید: فاصله برای انتخاب، پیکان‌ها برای جابه‌جایی، Ctrl و پیکان برای انتقال به دستهٔ دیگر، Enter برای ثبت و Escape برای انصراف.</span>
      </p>
      {display.layout === "flat" ? <div className="home-flat-grid" data-drop-flat>{display.flatOrder.map(tile)}</div> : display.groupOrder.map((id) => {
        const groupId = id as HomeGroupId, group = groupById.get(groupId)!, ids = display.groupModules[groupId], style = groupStyle[groupId];
        return <details key={id} name="home-catalog-groups" className={`home-group tone-${style.tone}`} data-home-group={id} open={display.openGroups.includes(id)}
          onToggle={(event) => {
            const details = event.currentTarget;
            if (disabled || dragging() || !details.isConnected) return;
            if (details.open) root.current?.querySelectorAll<HTMLDetailsElement>("details[data-home-group]").forEach((other) => {
              if (other !== details) other.open = false;
            });
            // A delayed close event for the previous group must retain the new
            // open group. The DOM also covers browsers without details grouping.
            const openId = root.current?.querySelector<HTMLDetailsElement>("details[data-home-group][open]")?.dataset.homeGroup;
            const openGroups = openId ? [openId] : [];
            if (openGroups[0] === display.openGroups[0] && openGroups.length === display.openGroups.length) return;
            commit({ ...display, openGroups });
          }}>
          <summary data-drop-group={id}>
            {style.icon ? <span className="hub-tile-ic" aria-hidden="true"><Icon name={style.icon} size={21} /></span> : null}
            <div className="home-group-copy"><h3>{group.title}</h3><p>{ids.length ? ids.slice(0, 3).map((moduleId) => byId.get(moduleId)!.title).join("، ") : "کاشی‌های دلخواهت را به این دسته بیاور"}</p></div>
            <span className="home-group-count">{toFa(ids.length)} بخش</span>
            <div className="home-group-tools">{position("group", id, group.title)}{handle("group", id, group.title)}</div>
            <span className="home-group-arrow" aria-hidden="true"><Icon name="i-arrow-l" size={17} /></span>
          </summary>
          <div className="home-group-grid" data-drop-group={id}>{ids.length ? ids.map(tile) : <p className="home-empty-group">کاشی را اینجا رها کن</p>}</div>
        </details>;
      })}
    </section>
    <p className="home-sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
    <dialog className="home-arrange-dialog" ref={dialog} aria-labelledby="home-arrange-title"
      onCancel={(event) => { event.preventDefault(); closeDialog(); }} onClick={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <div className="home-arrange-content">
        <div className="home-section-head"><h2 id="home-arrange-title">{arrangeItem ? `جایگاه ${arrangeTitle}` : arrangeTitle}</h2>
          <button type="button" className="home-arrange-close" aria-label="بستن تنظیم چیدمان" onClick={closeDialog}><Icon name="i-x" size={20} /></button>
        </div>
        {arrangeItem ? <>
          <p className="home-arrange-note">جایگاه {toFa(arrangeIndex + 1)} از {toFa(arrangeList.length)}</p>
          <div className="home-arrange-actions"><button type="button" disabled={disabled || arrangeIndex <= 0} onClick={() => step(-1)}>جابه‌جایی به جایگاه قبل</button>
            <button type="button" disabled={disabled || arrangeIndex >= arrangeList.length - 1} onClick={() => step(1)}>جابه‌جایی به جایگاه بعد</button></div>
          {arrangeItem.kind === "module" ? <><label htmlFor="home-transfer-group">انتقال به دستهٔ دلخواه</label>
            <select id="home-transfer-group" value={arrangeGroup} disabled={disabled} onChange={(event) => {
              const target = event.target.value as HomeGroupId;
              let next = moveHomeModule(display, arrangeItem.id, target, display.groupModules[target].filter((id) => id !== arrangeItem.id).length);
              next = { ...next, openGroups: [target] };
              commit(next);
            }}>{display.groupOrder.map((id) => <option value={id} key={id}>{groupById.get(id as HomeGroupId)!.title}</option>)}</select></> : null}
        </> : <>
          <p className="home-arrange-note">چیدمان برای حساب خودت ذخیره می‌شود. با دکمهٔ پین، هر بخش را به بالای خانه بیاور.</p>
          <label htmlFor="home-layout">نمایش بخش‌ها</label>
          <select id="home-layout" value={display.layout} disabled={disabled} onChange={(event) => commit({ ...display, layout: event.target.value as HomePreferences["layout"] })}>
            <option value="grouped">دسته‌بندی‌شده</option><option value="flat">همهٔ کاشی‌ها</option>
          </select>
          <div className="home-arrange-actions"><button type="button" disabled={disabled} onClick={() => { onReset(); closeDialog(); }}>بازگشت به چیدمان اولیه</button></div>
        </>}
      </div>
    </dialog>
  </div>;
}
