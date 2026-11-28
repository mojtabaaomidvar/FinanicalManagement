import { useLayoutEffect, useRef, type RefObject } from "react";

const layers: { element: HTMLElement; order: number }[] = [];
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = "";
const selector = 'a[href],button:not(:disabled),input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),summary,[tabindex]:not([tabindex="-1"])';
const controls = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>(selector)]
  .filter(node => node.getClientRects().length && !node.closest('[hidden],[inert],[aria-hidden="true"],fieldset:disabled'));
const top = () => layers.at(-1)?.element;

function updateBackground() {
  for (const [element, value] of originalInert) element.inert = value;
  if (!layers.length) { originalInert.clear(); document.body.style.overflow = originalOverflow; return; }
  const active = top()!;
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement) || child.contains(active)) continue;
    if (!originalInert.has(child)) originalInert.set(child, child.inert);
    child.inert = true;
  }
  document.body.style.overflow = "hidden";
}

/** Modal and date overlays share the existing back-guard opening order. */
export function useDialogFocus(ref: RefObject<HTMLDivElement>, visible: boolean, order: number | null, close: () => void) {
  const closeRef = useRef(close); closeRef.current = close;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!visible || !element || order === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!layers.length) originalOverflow = document.body.style.overflow;
    const layer = { element, order };
    layers.push(layer); layers.sort((a, b) => a.order - b.order);
    updateBackground();
    const focusFirst = () => (controls(element)[0] ?? element).focus({ preventScroll: true });
    if (top() === element && !element.contains(document.activeElement)) focusFirst();
    const onKey = (event: KeyboardEvent) => {
      if (top() !== element) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return;
      }
      if (event.key !== "Tab") return;
      const items = controls(element), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); element.focus(); }
      else if (!element.contains(document.activeElement) || document.activeElement === element) {
        event.preventDefault(); (event.shiftKey ? last! : first).focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last!.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => {
      if (top() === element && event.target instanceof Node && !element.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus);
      layers.splice(layers.indexOf(layer), 1); updateBackground();
      requestAnimationFrame(() => {
        if (opener?.isConnected && !opener.closest("[inert],[hidden]") && (!top() || top()!.contains(opener))) {
          opener.focus({ preventScroll: true });
        }
      });
    };
  }, [ref, visible, order]);
}
