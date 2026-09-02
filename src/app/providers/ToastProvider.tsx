/* Toast — پیام کوتاه پایین صفحه (با دکمه عملیات اختیاری مثل «به‌روزرسانی») */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface ToastState {
  show: (msg: string, action?: { label: string; onClick: () => void }) => void;
}

const ToastContext = createContext<ToastState>({ show: () => {} });

const AUTO_MS = 3200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState("");
  const [action, setAction] = useState<{
    label: string;
    onClick: () => void;
  } | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<ToastState["show"]>((m, act) => {
    setMsg(m);
    setAction(act ?? null);
    setVisible(true);
    window.clearTimeout(timer.current);
    /* پیام دکمه‌دار دیرتر محو می‌شود تا کاربر فرصت ببیند */
    timer.current = window.setTimeout(
      () => setVisible(false),
      act ? AUTO_MS + 4000 : AUTO_MS - 800,
    );
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={`toast ${visible ? "" : "hidden"}`} role="status">
        <span>{msg}</span>
        {action ? (
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              setVisible(false);
              window.clearTimeout(timer.current);
              action.onClick();
            }}
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  return useContext(ToastContext);
}
