import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useLayoutEffect, useRef, type HTMLAttributes, type ReactElement } from "react";
import { usePageActivity } from "@/shared/lib/pageActivity";
import "./AppPage.css";

export const PageNavigationContext = createContext<{ back: () => void; canBack: boolean } | null>(null);
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Existing source headers/copy stay intact; only scroll ownership is shared. */
export function AppPage({ children, className = "", ...props }: HTMLAttributes<HTMLElement>) {
  const active = usePageActivity();
  const navigation = useContext(PageNavigationContext);
  const scroll = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const wasActive = useRef(active);
  // A scroll event may still be queued when navigation starts. Snapshot the
  // outgoing DOM before React hides it; layout-effect cleanup is already too late.
  if (wasActive.current && !active && scroll.current) position.current = scroll.current.scrollTop;
  wasActive.current = active;
  const elements = Children.toArray(children);
  const header = elements.find(child => isValidElement(child) && child.type === "header") as ReactElement<HTMLAttributes<HTMLElement>> | undefined;
  useBrowserLayoutEffect(() => {
    if (!active) return;
    const restore = () => { if (scroll.current) scroll.current.scrollTop = position.current; };
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [active]);
  const backButton = navigation?.canBack ? <button key="page-back" type="button" className="icon-btn shared-page-back"
    aria-label="بازگشت به صفحهٔ قبل" onClick={navigation.back}>
    <svg aria-hidden="true"><use href="#i-arrow-r" /></svg>
  </button> : null;
  return <section {...props} className={`${className} shared-app-page`}>
    {header ? cloneElement(header, { className: `${header.props.className ?? ""} shared-page-header` }, backButton, header.props.children) : null}
    <div ref={scroll} className="page-scroll" onScroll={event => {
      if (active) position.current = event.currentTarget.scrollTop;
    }}>{elements.filter(child => child !== header)}</div>
  </section>;
}
