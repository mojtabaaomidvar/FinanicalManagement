import { Component, lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@/global.css";
import { isSupportHost } from "@/shared/config/support";
const Application = lazy(() => import("@/app/Application"));
const SupportPanel = lazy(() => import("@/features/support/SupportPanel").then(module => ({ default: module.SupportPanel })));
const previewSupport = import.meta.env.MODE === "copy-workbench"
  && (window as Window & { __COPY_PREVIEW__?: { route?: string } }).__COPY_PREVIEW__?.route === "support";
const isSupport = isSupportHost() || window.location.pathname.replace(/\/$/, "") === "/support" || previewSupport;

class EntryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main dir="rtl" style={{ padding: 32 }} role="alert">
      <p>بارگذاری برنامه انجام نشد.</p><button onClick={() => window.location.reload()}>تلاش دوباره</button>
    </main>;
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EntryBoundary><Suspense fallback={<main dir="rtl" style={{ padding: 32 }} role="status">در حال بارگذاری برنامه…</main>}>
      {isSupport ? <SupportPanel /> : <Application />}
    </Suspense></EntryBoundary>
  </StrictMode>,
);
