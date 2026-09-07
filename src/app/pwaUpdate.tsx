/* مدیریت به‌روزرسانی PWA — تشخیص نسخه جدید در انتظار و اعمال آن
   registerType=prompt: SW جدید نصب می‌شود ولی تا تایید کاربر فعال نمی‌شود

   نکته مهم درباره اپ اندروید: در capacitor.config.ts مقدار server.url ست
   شده، یعنی WebView مستقیم همان سایت دپلوی‌شده را لود می‌کند (OTA). پس
   دقیقاً همین مسیر سرویس‌ورکر است که آپدیت اپ نیتیو را می‌رساند و نباید
   خاموش باشد. قبلاً اینجا یک گارد isNativeApp() بود که کل تشخیص را در اپ
   می‌بست و باعث می‌شد اپ اندروید هیچ‌وقت نسخه تازه را نبیند. */

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

/* اپ نیتیو معمولاً ریلود نمی‌شود و فقط از پس‌زمینه برمی‌گردد؛ ولی هر
   بازگشت هم نباید یک درخواست شبکه بزند */
const RESUME_CHECK_GAP_MS = 60_000;

export function usePwaUpdate(): PwaUpdateState {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | undefined;
    let lastCheck = 0;

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
      registration = reg;

      markWaiting(reg);
      reg.addEventListener("updatefound", () => watchInstalling(reg));
      watchInstalling(reg);

      /* هر بار بازشدن برنامه، نسخه منتشرشده بررسی می‌شود. */
      lastCheck = Date.now();
      try {
        await reg.update();
        markWaiting(reg);
      } catch {
        /* بررسی نسخه نباید مانع بازشدن برنامه شود. */
      }
    }

    /** بازگشت از پس‌زمینه — تنها فرصت واقعی اپ نیتیو برای دیدن نسخه تازه */
    function onVisible() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheck < RESUME_CHECK_GAP_MS) return;
      lastCheck = now;
      void (async () => {
        const reg =
          registration ?? (await navigator.serviceWorker.getRegistration());
        if (!reg || cancelled) return;
        registration = reg;
        try {
          await reg.update();
        } catch {
          return;
        }
        markWaiting(reg);
      })();
    }

    void setup();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
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
    try {
      await reg.update();
    } catch {
      return false;
    }

    /* آپدیت async نصب می‌شود؛ اگر waiting بود همین حالا خبر بده */
    if (reg.waiting && navigator.serviceWorker.controller) {
      setUpdateReady(true);
      return true;
    }

    /* reg.update() فقط دانلود را شروع می‌کند. اگر همین‌جا برگردیم، وقتی
       نسخه تازه هنوز در حال نصب است می‌گوییم «آخرین نسخه را دارید» —
       که دقیقاً همان حسِ «آپدیت را نشناخت» را می‌دهد. پس تا پایان نصب
       صبر می‌کنیم (با سقف زمانی تا روی شبکه کند گیر نکنیم). */
    const installing = reg.installing;
    if (!installing) return false;
    /* تایپ غیرnull جدا نگه داشته می‌شود چون narrowing داخل function
       declaration (که hoist می‌شود) حفظ نمی‌شود */
    const sw: ServiceWorker = installing;

    const installed = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (v: boolean) => {
        if (settled) return;
        settled = true;
        sw.removeEventListener("statechange", onState);
        clearTimeout(timer);
        resolve(v);
      };
      function onState() {
        if (sw.state === "installed") finish(true);
        else if (sw.state === "redundant") finish(false);
      }
      const timer = setTimeout(() => finish(false), 10_000);
      sw.addEventListener("statechange", onState);
    });

    if (installed && reg.waiting && navigator.serviceWorker.controller) {
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
