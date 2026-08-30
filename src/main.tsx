import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/global.css";
import { App } from "@/app/App";
import { AppProvider } from "@/app/providers/AppProvider";
import { ToastProvider } from "@/app/providers/ToastProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </ToastProvider>
  </StrictMode>,
);
