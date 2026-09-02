/* مدیریت به‌روزرسانی PWA — تشخیص نسخه جدید در انتظار و اعمال آن
   registerType=prompt: SW جدید نصب می‌شود ولی تا تایید کاربر فعال نمی‌شود */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export interface PwaUpdateState {
  /** نسخه جدید نصب‌شده و منتظر فعال‌سازی است */
  updateReady: boolean;
  /** فعال‌سازی نسخه جدید و بارگذاری مجدد صفحه */
  applyUpdate: () => void;
  /** بررسی دستی (برای صفحه تنظیمات) */
  checkForUpdate: () => Promise<boolean>;
}

export function usePwaUpdate(): PwaUpdateState {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    function markWaiting(reg: ServiceWorkerRegistration) {
      if (!cancelled && reg.waiting && navigator.serviceWorker.controller) {
        setUpdateReady(true);
      }
    }

    function watchInstalling(reg: ServiceWorkerRegistration) {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed") markWaiting(reg);
      });
    }

    async function setup() {
      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        try {
          reg = await navigator.serviceWorker.ready;
        } catch {
          return;
        }
      }
      if (cancelled) return;

      markWaiting(reg);
      reg.addEventListener("updatefound", () => watchInstalling(reg));
      watchInstalling(reg);

      /* هر بار بازشدن برنامه، نسخه منتشرشده بررسی می‌شود. */
      try {
        await reg.update();
        markWaiting(reg);
      } catch {
        /* بررسی نسخه نباید مانع بازشدن برنامه شود. */
      }
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyUpdate = useCallback(() => {
    void (async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      const waiting = reg?.waiting;
      if (waiting) {
        waiting.postMessage({ type: "SKIP_WAITING" });
        waiting.addEventListener("statechange", () => {
          if (waiting.state === "activated") location.reload();
        });
        /* اگر رویداد نیامد، ریلود تضمینی */
        setTimeout(() => location.reload(), 1500);
      } else {
        location.reload();
      }
    })();
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.update();
    /* آپدیت async نصب می‌شود؛ اگر waiting بود همین حالا خبر بده */
    if (reg.waiting && navigator.serviceWorker.controller) {
      setUpdateReady(true);
      return true;
    }
    return false;
  }, []);

  return { updateReady, applyUpdate, checkForUpdate };
}

/* ── کانتکست — یک نمونه مشترک برای کل اپ ── */

const PwaUpdateCtx = createContext<PwaUpdateState | null>(null);

export function PwaUpdateProvider({ children }: { children: ReactNode }) {
  const value = usePwaUpdate();
  return <PwaUpdateCtx.Provider value={value}>{children}</PwaUpdateCtx.Provider>;
}

export function usePwaUpdateState(): PwaUpdateState {
  const v = useContext(PwaUpdateCtx);
  if (!v) throw new Error("PwaUpdateProvider missing");
  return v;
}
