import { useEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { usePageActivity } from "@/shared/lib/pageActivity";
import type { HomeGroupId, HomePreferences } from "@/domain/home/homePreferences.types";
import { homeModuleGroup, moveHomeModule, normalizeHomePreferences, reorderHomeItem } from "@/domain/home/homePreferences.rules";

export type HomeDragKind = "pin" | "module" | "group";
type Item = { kind: HomeDragKind; id: string; source: HTMLElement; handle: HTMLButtonElement };
type Candidate = Item & { pointerId: number; startX: number; startY: number; x: number; y: number };
type Target = { kind: HomeDragKind | "flat"; id?: HomeGroupId; index: number; zone: HTMLElement; anchor?: HTMLElement; before?: boolean; vertical?: boolean };
type Drag = Item & {
  mode: "pointer" | "keyboard"; snapshot: HomePreferences; pointerId?: number;
  x: number; y: number; offsetX: number; offsetY: number; ghost?: HTMLElement;
  target?: Target; raf?: number; hover?: HTMLDetailsElement; timer?: ReturnType<typeof setTimeout>;
};

/** Pointer previews never mutate preferences. Keyboard previews are local until Enter. */
export function useHomeDrag({ root, preferences, onChange, disabled, lifecycleKey }: {
  root: RefObject<HTMLDivElement>; preferences: HomePreferences;
  onChange: (next: HomePreferences) => void; disabled: boolean; lifecycleKey: string;
}) {
  const active = usePageActivity();
  const [preview, setPreview] = useState<HomePreferences | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const latest = useRef({ preferences, onChange, disabled });
  latest.current = { preferences, onChange, disabled };
  const working = useRef(preferences);
  if (!preview) working.current = preferences;
  const drag = useRef<Drag | null>(null);
  const candidate = useRef<Candidate | null>(null);
  const suppress = useRef(0);
  const finishRef = useRef<(commit: boolean, focus?: boolean) => void>(() => {});

  useEffect(() => {
    const container = root.current;
    if (!container || !active) return;
    const scroller = container.closest<HTMLElement>(".page-scroll");
    let line: HTMLDivElement | undefined;
    let disposed = false;
    function info(handle: HTMLButtonElement): Item | undefined {
      const kind = handle.dataset.homeDrag as HomeDragKind;
      const id = handle.dataset.dragId;
      const selector = kind === "pin" ? "[data-shortcut-id]" : kind === "group" ? "details[data-home-group]" : "[data-module-id]";
      const source = handle.closest<HTMLElement>(selector);
      if (id && source && ["pin", "module", "group"].includes(kind)) return { kind, id, source, handle };
    }
    function findHandle(kind: HomeDragKind, id: string) {
      return container!.querySelector<HTMLButtonElement>(`[data-home-drag="${kind}"][data-drag-id="${id}"]`);
    }
    function clearDrop() {
      container!.querySelectorAll(".home-drop-target").forEach((node) => node.classList.remove("home-drop-target"));
      if (line) line.hidden = true;
    }
    function restoreOpen(prefs: HomePreferences) {
      container!.querySelectorAll<HTMLDetailsElement>("details[data-home-group]").forEach((node) => {
        node.open = prefs.openGroups.includes(node.dataset.homeGroup!);
      });
    }
    function finish(commit: boolean, focus = true) {
      const item = drag.current;
      const pending = candidate.current;
      // Clear refs before releasePointerCapture: lostpointercapture is synchronous in some browsers.
      drag.current = null; candidate.current = null;
      if (!item) {
        if (pending) { try { pending.handle.releasePointerCapture(pending.pointerId); } catch { /* already released */ } }
        return;
      }
      if (item.raf) cancelAnimationFrame(item.raf);
      clearTimeout(item.timer); item.ghost?.remove(); clearDrop();
      container!.querySelectorAll(".home-is-dragging").forEach((node) => node.classList.remove("home-is-dragging"));
      container!.querySelectorAll('[data-home-drag][aria-pressed="true"]').forEach((node) => node.setAttribute("aria-pressed", "false"));
      document.body.removeAttribute("data-home-dragging");
      let next = item.mode === "keyboard" ? working.current : item.snapshot;
      if (item.mode === "pointer" && commit && item.target) {
        const target = item.target;
        if (target.kind === "pin") next = { ...next, pins: reorderHomeItem(next.pins, item.id, target.index) };
        else if (target.kind === "flat") next = { ...next, flatOrder: reorderHomeItem(next.flatOrder, item.id, target.index) };
        else if (target.kind === "group") next = { ...next, groupOrder: reorderHomeItem(next.groupOrder, item.id, target.index) };
        else if (target.id) {
          next = moveHomeModule(next, item.id, target.id, target.index);
          if (target.zone.closest("details")?.open) {
            next = { ...next, openGroups: [target.id] };
          }
        }
      }
      const valid = commit && (item.mode === "keyboard" || Boolean(item.target));
      if (!valid) next = latest.current.preferences;
      restoreOpen(next); working.current = next;
      if (!disposed) setPreview(null);
      suppress.current = performance.now() + 350;
      if (item.pointerId !== undefined) { try { item.handle.releasePointerCapture(item.pointerId); } catch { /* already released */ } }
      const changed = JSON.stringify(next) !== JSON.stringify(item.snapshot);
      // Commit the moved tile before resolving its new focus target. Under load,
      // a queued render can otherwise remove the node focused by this frame.
      if (valid && changed && !disposed) flushSync(() => latest.current.onChange(normalizeHomePreferences(next)));
      if (!disposed) setAnnouncement(valid ? "چیدمان جدید ثبت شد." : "جابه‌جایی لغو شد.");
      if (focus && !disposed) requestAnimationFrame(() => {
        if (disposed) return;
        const handle = findHandle(item.kind, item.id);
        const group = handle?.closest<HTMLDetailsElement>("details[data-home-group]");
        if (handle?.getClientRects().length && (!group || group.open || item.kind === "group")) handle.focus({ preventScroll: true });
        else if (item.kind === "module") {
          // A fast drop into a collapsed group keeps it collapsed; retain an accessible focus target.
          container!.querySelector(`[data-module-id="${item.id}"]`)?.closest("details")?.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
        }
      });
    }
    finishRef.current = finish;
    function insertion(zone: HTMLElement, selector: string, excluded: string, x: number, y: number) {
      const nodes = [...zone.querySelectorAll<HTMLElement>(selector)].filter((node) => (node.dataset.moduleId ?? node.dataset.shortcutId) !== excluded);
      if (!nodes.length) return { index: 0 };
      const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(selector);
      const anchor = hit && nodes.includes(hit) ? hit : nodes.reduce((best, node) => {
        const box = node.getBoundingClientRect();
        const dx = Math.max(box.left - x, 0, x - box.right), dy = Math.max(box.top - y, 0, y - box.bottom);
        const distance = dx * dx + dy * dy;
        return !best || distance < best.distance ? { node, distance } : best;
      }, undefined as { node: HTMLElement; distance: number } | undefined)!.node;
      const box = anchor.getBoundingClientRect();
      const before = y < box.top ? true : y > box.bottom ? false : x > box.left + box.width / 2;
      return { index: nodes.indexOf(anchor) + (before ? 0 : 1), anchor, before };
    }
    function dropAt(item: Drag): Target | undefined {
      const { x, y } = item;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !container!.contains(hit) || item.source.contains(hit)) return;
      if (item.kind === "group") {
        const group = hit.closest<HTMLElement>("details[data-home-group]");
        if (!group || group.dataset.homeGroup === item.id) return;
        const summary = group.querySelector<HTMLElement>("summary")!;
        const before = y < summary.getBoundingClientRect().top + summary.getBoundingClientRect().height / 2;
        return { kind: "group", index: working.current.groupOrder.filter((id) => id !== item.id).indexOf(group.dataset.homeGroup!) + (before ? 0 : 1), zone: summary, anchor: summary, before, vertical: true };
      }
      const quick = hit.closest<HTMLElement>("[data-drop-pins]");
      if (quick) return { kind: "pin", zone: quick, ...insertion(quick, "[data-shortcut-id]", item.id, x, y) };
      if (item.kind === "pin") return;
      const flat = hit.closest<HTMLElement>("[data-drop-flat]");
      if (flat) return { kind: "flat", zone: flat, ...insertion(flat, "[data-module-id]", item.id, x, y) };
      const zone = hit.closest<HTMLElement>("[data-drop-group]");
      const id = zone?.dataset.dropGroup as HomeGroupId | undefined;
      if (!zone || !id || !working.current.groupOrder.includes(id)) return;
      return { kind: "module", id, zone, ...(zone.tagName === "SUMMARY" ? { index: working.current.groupModules[id].filter((value) => value !== item.id).length } : insertion(zone, "[data-module-id]", item.id, x, y)) };
    }
    function update() {
      const item = drag.current;
      if (!item || item.mode !== "pointer") return;
      if (item.ghost) { item.ghost.style.left = `${item.x - item.offsetX}px`; item.ghost.style.top = `${item.y - item.offsetY}px`; }
      item.target = dropAt(item); clearDrop();
      const target = item.target;
      if (target) {
        target.zone.classList.add("home-drop-target");
        if (target.anchor) {
          line ??= Object.assign(document.createElement("div"), { className: "home-drop-indicator" });
          if (!line.isConnected) document.body.append(line);
          const box = target.anchor.getBoundingClientRect();
          Object.assign(line.style, target.vertical
            ? { left: `${box.left}px`, top: `${target.before ? box.top : box.bottom}px`, width: `${box.width}px`, height: "4px" }
            : { left: `${(target.before ? box.right : box.left) - 2}px`, top: `${box.top}px`, width: "4px", height: `${box.height}px` });
          line.hidden = false;
        }
      }
      const closed = item.kind === "module" ? document.elementFromPoint(item.x, item.y)?.closest<HTMLDetailsElement>("details[data-home-group]:not([open])") : null;
      if (closed !== item.hover) {
        clearTimeout(item.timer); item.hover = closed ?? undefined;
        if (closed) item.timer = setTimeout(() => {
          if (drag.current === item && item.hover === closed) {
            container!.querySelectorAll<HTMLDetailsElement>("details[data-home-group]").forEach((node) => {
              if (node !== closed) node.open = false;
            });
            closed.open = true; update();
          }
        }, 650);
      }
    }
    function frame() {
      const item = drag.current;
      if (!item || item.mode !== "pointer") return;
      const bounds = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
      const edge = 58, within = item.x >= 0 && item.x <= innerWidth && item.y >= bounds.top && item.y <= bounds.bottom;
      const delta = within ? item.y < bounds.top + edge ? -Math.ceil((bounds.top + edge - item.y) / 4) : item.y > bounds.bottom - edge ? Math.ceil((item.y - bounds.bottom + edge) / 4) : 0 : 0;
      if (delta) { (scroller ?? window).scrollBy({ top: delta, behavior: "instant" }); update(); }
      item.raf = requestAnimationFrame(frame);
    }
    function startPointer() {
      const item = candidate.current;
      if (!item) return;
      const visual = item.kind === "group" ? item.source.querySelector<HTMLElement>("summary")! : item.source;
      const box = visual.getBoundingClientRect();
      const ghost = visual.cloneNode(true) as HTMLElement;
      ghost.classList.add("home-drag-ghost", "home-modules");
      if (item.kind === "group") item.source.classList.forEach((name) => { if (name.startsWith("tone-")) ghost.classList.add(name); });
      ghost.setAttribute("aria-hidden", "true");
      ghost.inert = true;
      // The visual copy must never masquerade as a live navigation control or drop target.
      [ghost, ...ghost.querySelectorAll<HTMLElement>("*")].forEach((node) => {
        node.removeAttribute("id");
        [...node.attributes].filter((attr) => attr.name.startsWith("data-")).forEach((attr) => node.removeAttribute(attr.name));
      });
      ghost.querySelectorAll("button").forEach((node) => node.tabIndex = -1);
      ghost.style.width = `${box.width}px`; document.body.append(ghost);
      drag.current = { ...item, mode: "pointer", snapshot: normalizeHomePreferences(latest.current.preferences), ghost,
        offsetX: Math.max(0, Math.min(item.startX - box.left, box.width)), offsetY: Math.max(0, Math.min(item.startY - box.top, box.height)) };
      candidate.current = null; item.source.classList.add("home-is-dragging"); item.handle.setAttribute("aria-pressed", "true");
      document.body.dataset.homeDragging = item.kind; update(); drag.current.raf = requestAnimationFrame(frame);
    }
    function down(event: PointerEvent) {
      const node = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-home-drag]") : null;
      if (!node || !container!.contains(node) || latest.current.disabled || event.button !== 0 || !event.isPrimary) return;
      let handle = node;
      if (drag.current || candidate.current) {
        const previous = info(handle);
        // React may move a keyboard preview between groups; reacquire after restoring the attached tree.
        flushSync(() => finish(false, false));
        if (!previous) return;
        const attached = findHandle(previous.kind, previous.id);
        if (!attached) return;
        handle = attached;
      }
      const item = info(handle); if (!item) return;
      event.preventDefault(); handle.focus({ preventScroll: true });
      candidate.current = { ...item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
      try { handle.setPointerCapture(event.pointerId); } catch { candidate.current = null; }
    }
    function move(event: PointerEvent) {
      const pending = candidate.current;
      if (pending?.pointerId === event.pointerId) {
        pending.x = event.clientX; pending.y = event.clientY;
        if (Math.hypot(pending.x - pending.startX, pending.y - pending.startY) >= 7) startPointer();
      }
      const item = drag.current;
      if (item?.mode === "pointer" && item.pointerId === event.pointerId) { event.preventDefault(); item.x = event.clientX; item.y = event.clientY; update(); }
    }
    function up(event: PointerEvent) {
      const item = drag.current;
      if (item?.mode === "pointer" && item.pointerId === event.pointerId) { item.x = event.clientX; item.y = event.clientY; update(); finish(true); }
      else if (candidate.current?.pointerId === event.pointerId) finish(false);
    }
    function cancel(event: PointerEvent) { if (drag.current?.pointerId === event.pointerId || candidate.current?.pointerId === event.pointerId) finish(false); }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape" && (drag.current || candidate.current)) { event.preventDefault(); event.stopPropagation(); finish(false); return; }
      const handle = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-home-drag]") : null;
      if (!handle || !container!.contains(handle) || latest.current.disabled) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (drag.current?.mode === "pointer" || candidate.current) return;
        if (drag.current?.mode === "keyboard") { finish(true); return; }
        const item = info(handle); if (!item) return;
        working.current = normalizeHomePreferences(latest.current.preferences);
        drag.current = { ...item, mode: "keyboard", snapshot: normalizeHomePreferences(working.current), x: 0, y: 0, offsetX: 0, offsetY: 0 };
        item.source.classList.add("home-is-dragging"); handle.setAttribute("aria-pressed", "true");
        document.body.dataset.homeDragging = item.kind;
        setAnnouncement("انتخاب شد؛ با پیکان‌ها جابه‌جا کن و با Enter ثبت کن."); return;
      }
      const item = drag.current;
      if (!item || item.mode !== "keyboard") return;
      if (event.key === "Tab") { finish(false, false); return; }
      const direction = ["ArrowUp", "ArrowRight"].includes(event.key) ? -1 : ["ArrowDown", "ArrowLeft"].includes(event.key) ? 1 : 0;
      if (!direction) return;
      event.preventDefault(); let next = working.current;
      if (item.kind === "module" && event.ctrlKey && next.layout === "grouped") {
        const group = homeModuleGroup(next, item.id)!;
        const target = next.groupOrder[next.groupOrder.indexOf(group) + direction] as HomeGroupId | undefined;
        if (target) { next = moveHomeModule(next, item.id, target, next.groupModules[target].length); next = { ...next, openGroups: [target] }; }
      } else {
        const group = homeModuleGroup(next, item.id)!;
        const list = item.kind === "pin" ? next.pins : item.kind === "group" ? next.groupOrder : next.layout === "flat" ? next.flatOrder : next.groupModules[group];
        const index = list.indexOf(item.id), target = index + direction;
        if (target >= 0 && target < list.length) {
          const order = reorderHomeItem(list, item.id, target);
          next = item.kind === "pin" ? { ...next, pins: order } : item.kind === "group" ? { ...next, groupOrder: order } : next.layout === "flat" ? { ...next, flatOrder: order } : moveHomeModule(next, item.id, group, target);
        }
      }
      working.current = next; setPreview(next);
      requestAnimationFrame(() => {
        if (drag.current !== item) return;
        const attached = findHandle(item.kind, item.id);
        if (!attached) return;
        const moved = info(attached)!; item.source.classList.remove("home-is-dragging"); item.handle.setAttribute("aria-pressed", "false");
        item.source = moved.source; item.handle = attached; moved.source.classList.add("home-is-dragging"); attached.setAttribute("aria-pressed", "true");
        attached.focus({ preventScroll: true }); attached.scrollIntoView({ block: "nearest", behavior: "instant" });
      });
      setAnnouncement("جایگاه تغییر کرد؛ Enter برای ثبت و Escape برای انصراف.");
    }
    function click(event: MouseEvent) {
      if (!(event.target instanceof Node) || !container!.contains(event.target)) return;
      if (performance.now() < suppress.current || drag.current || candidate.current) { event.preventDefault(); event.stopPropagation(); }
    }
    function blur() { if (drag.current || candidate.current) finish(false, false); }
    document.addEventListener("pointerdown", down);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("lostpointercapture", cancel);
    document.addEventListener("keydown", key, true);
    document.addEventListener("click", click, true);
    window.addEventListener("blur", blur);
    return () => {
      disposed = true; finish(false, false); line?.remove();
      document.removeEventListener("pointerdown", down); document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("lostpointercapture", cancel); document.removeEventListener("keydown", key, true);
      document.removeEventListener("click", click, true); window.removeEventListener("blur", blur);
    };
  }, [root, active]);

  useEffect(() => { finishRef.current(false, false); setPreview(null); }, [disabled, lifecycleKey]);
  useEffect(() => { if (drag.current || candidate.current) finishRef.current(false, false); }, [preferences]);
  return { display: preview ?? preferences, announcement, dragging: () => Boolean(drag.current || candidate.current), cancel: () => finishRef.current(false) };
}
