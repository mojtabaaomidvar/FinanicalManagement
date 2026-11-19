import { App } from "./App";
import { AppProvider } from "./providers/AppProvider";
import { ToastProvider } from "./providers/ToastProvider";

export default function Application() {
  return <ToastProvider><AppProvider><App /></AppProvider></ToastProvider>;
}
