/* Toast — پیام کوتاه پایین صفحه */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastState {
  show: (msg: string) => void;
}

const ToastContext = createContext<ToastState>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((m: string) => {
    setMsg(m);
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 2400);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={`toast ${visible ? "" : "hidden"}`} role="status">
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  return useContext(ToastContext);
}
