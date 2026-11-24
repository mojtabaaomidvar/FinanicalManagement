import { useEffect, useState } from "react";

export function useMobileViewport() {
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      // Pinch zoom must not be mistaken for an on-screen keyboard.
      const normalScale = !viewport || Math.abs(viewport.scale - 1) < 0.01;
      const height = normalScale ? viewport?.height ?? window.innerHeight : window.innerHeight;
      const top = normalScale ? viewport?.offsetTop ?? 0 : 0;
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-viewport-top", `${top}px`);
      const editing = document.activeElement?.matches("textarea, input:not([type=checkbox]):not([type=radio]), [contenteditable=true]") ?? false;
      setKeyboard(normalScale && (window.innerHeight - height > 120 || editing && matchMedia("(pointer: coarse)").matches));
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    return () => {
      viewport?.removeEventListener("resize", update); viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.removeEventListener("focusin", update); document.removeEventListener("focusout", update);
      root.style.removeProperty("--app-viewport-height"); root.style.removeProperty("--app-viewport-top");
    };
  }, []);
  return keyboard;
}
