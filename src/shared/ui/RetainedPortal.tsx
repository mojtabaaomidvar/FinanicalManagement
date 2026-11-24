import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const attached: { container: HTMLDivElement; order: number }[] = [];

/** Keep open overlay children mounted without leaving inactive UI in the document. */
export function RetainedPortal({ visible, order, children }: { visible: boolean; order: number; children: ReactNode }) {
  const [container] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    if (!visible) return;
    // Layout effects restore children first; equal-z-index sheets still need
    // their original parent-before-child DOM order for pointer hit testing.
    const next = attached.filter(portal => portal.order > order).sort((a, b) => a.order - b.order)[0];
    document.body.insertBefore(container, next?.container ?? null);
    const portal = { container, order };
    attached.push(portal);
    return () => {
      attached.splice(attached.indexOf(portal), 1);
      container.remove();
    };
  }, [container, order, visible]);
  return createPortal(children, container);
}
