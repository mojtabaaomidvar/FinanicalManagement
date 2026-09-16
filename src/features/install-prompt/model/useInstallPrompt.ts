/* آیا باید صفحه‌ی «افزودن به صفحه‌ی اصلی» را نشان بدهیم؟

   قاعده‌ی کاربر: «هر بار تا نصب نکند» — یعنی این صفحه فلگِ «دیدم، دیگر
   نشانم نده» ندارد. تنها چیزی که خاموشش می‌کند نصبِ واقعی است.

   چهار دروازه، همه باید باز باشند تا صفحه دیده شود:

   ۱. اپِ نیتیو نباشد. خیلی مهم: طبق capacitor.config.ts، WebViewِ اندروید
      *همین آدرس* (pwa.khaanehyar.ir) را لود می‌کند. پس بدون این شرط، همان
      کسی که اپ را نصب کرده داخل اپ می‌بیند «اپ را نصب کن».
      دو لایه گارد داریم چون یکی کافی نیست:
        • Capacitor.isNativePlatform() — راه اصلی
        • «; wv» در User-Agent — تورِ ایمنی. اگر پلِ کپاسیتور دیر تزریق شود
          (تله‌ی شناخته‌شده‌ی این مخزن: getPlatform در سطح ماژول «web»
          می‌گوید) این یکی همچنان جلوی نمایش را می‌گیرد. هزینه‌اش این است
          که مرورگرهای داخلِ تلگرام/اینستاگرامِ اندروید هم صفحه را
          نمی‌بینند — که اشکالی ندارد، چون آن‌ها اصلاً امکان نصب ندارند.

   ۲. از قبل نصب‌شده نباشد. سه نشانه: حالت standalone (یعنی از روی آیکون
      باز شده)، navigator.standalone سافاری، و فلگی که با رویداد
      appinstalled می‌نویسیم (برای وقتی کاربر بعداً همین سایت را در تبِ
      مرورگر باز می‌کند).

   ۳. گوشی باشد، نه لپ‌تاپ و نه تبلت. کاربر روی این تأکید کرد. سه شرط
      هم‌زمان: نشانگرِ درشت (انگشت)، لمسی بودن، و کوچک‌ترین ضلعِ صفحه زیر
      ۶۰۰ پیکسل — همان مرزی که خودِ اندروید (sw600dp) تبلت می‌شناسد.
      لپ‌تاپِ لمسی هر سه را با هم ندارد.

   ۴. مرورگر بتواند چنین کاری بکند (فعلاً هر مرورگرِ گوشی می‌تواند). */

import { useCallback, useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

/** فلگِ «نصب شد» — تنها چیزی که این صفحه را برای همیشه خاموش می‌کند. */
const INSTALLED_KEY = "khaneyar.a2hs.installed";

export type InstallPlatform = "ios" | "android" | "other";

/* رویدادِ کروم برای نصبِ یک‌کلیکه. در lib.dom تایپ ندارد. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* حالت private در سافاری — بی‌خطر رد می‌شویم */
  }
}

/** داخل اپِ نصب‌شده‌ی اندروید (یا هر WebViewِ دیگری) اجرا می‌شویم؟ */
function isInsideWebView(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return true;
  } catch {
    /* پل هنوز نیامده — به تورِ ایمنیِ زیر تکیه می‌کنیم */
  }
  return / wv\)|; wv/i.test(navigator.userAgent);
}

/** از روی آیکونِ صفحه‌ی اصلی باز شده یا قبلاً نصب شده؟ */
function isAlreadyInstalled(): boolean {
  const displayModes = ["standalone", "fullscreen", "minimal-ui"];
  if (displayModes.some((m) => window.matchMedia(`(display-mode: ${m})`).matches))
    return true;
  /* سافاری iOS: تنها راهِ تشخیصش همین پرچمِ غیراستاندارد است */
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true)
    return true;
  return safeGet(INSTALLED_KEY) === "1";
}

/** گوشی است، نه تبلت و نه لپ‌تاپِ لمسی. */
function isPhone(): boolean {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const touch = navigator.maxTouchPoints > 0;
  const shortSide = Math.min(window.screen.width, window.screen.height);
  return coarse && touch && shortSide < 600;
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  /* آیپدِ iOS 13 به بعد خودش را مک معرفی می‌کند؛ لمسی‌بودن لوش می‌دهد */
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  return "other";
}

/** مرورگرِ داخلِ یک اپ دیگر (اینستاگرام، تلگرام، …) — نصب از آنجا کار نمی‌کند. */
function isInAppBrowser(): boolean {
  return /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|OKApp/i.test(
    navigator.userAgent,
  );
}

function shouldShow(): boolean {
  if (isInsideWebView()) return false;
  if (isAlreadyInstalled()) return false;
  if (!isPhone()) return false;
  return true;
}

export interface InstallPromptModel {
  /** صفحه را نشان بده؟ */
  visible: boolean;
  platform: InstallPlatform;
  /** مرورگرِ داخلِ اپِ دیگری است و باید اول در مرورگرِ اصلی باز شود */
  inAppBrowser: boolean;
  /** کروم اجازه‌ی نصبِ یک‌کلیکه داده است */
  canOneTap: boolean;
  /** نصبِ یک‌کلیکه (فقط وقتی canOneTap) */
  install: () => void;
  /** «فعلاً در مرورگر ادامه می‌دهم» — عمداً چیزی ذخیره نمی‌کند */
  skip: () => void;
}

export function useInstallPrompt(): InstallPromptModel {
  /* تصمیمِ اولیه هم‌زمان با اولین رندر گرفته می‌شود تا صفحه‌ی زیرین یک
     لحظه سوسو نزند. اگر پلِ کپاسیتور دیر برسد، افکتِ پایین تصحیحش می‌کند. */
  const [allowed, setAllowed] = useState(shouldShow);
  /* «فعلاً نه» فقط در حافظه است، نه localStorage: خواسته‌ی کاربر این بود
     که تا نصب نکرده، هر بار دوباره ببیند. */
  const [skipped, setSkipped] = useState(false);
  const [platform] = useState(detectPlatform);
  const [inAppBrowser] = useState(isInAppBrowser);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  /* بازبینیِ بعد از mount — همان تله‌ی تزریقِ دیرهنگامِ پلِ کپاسیتور */
  useEffect(() => {
    setAllowed(shouldShow());
  }, []);

  /* کروم اندروید: رویداد را نگه می‌داریم تا دکمه‌ی «نصب» واقعی بدهیم */
  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      safeSet(INSTALLED_KEY, "1");
      setAllowed(false);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  /* اگر کاربر بدون رفرش از مرورگر به حالت نصب‌شده رفت، صفحه باید برود */
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => {
      if (mq.matches) {
        safeSet(INSTALLED_KEY, "1");
        setAllowed(false);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const install = useCallback(() => {
    if (!deferred) return;
    void deferred.prompt();
    void deferred.userChoice.then((choice) => {
      if (choice.outcome === "accepted") {
        safeSet(INSTALLED_KEY, "1");
        setAllowed(false);
      }
      /* رویدادِ کروم یک‌بارمصرف است */
      setDeferred(null);
    });
  }, [deferred]);

  const skip = useCallback(() => setSkipped(true), []);

  return {
    visible: allowed && !skipped,
    platform,
    inAppBrowser,
    canOneTap: deferred !== null,
    install,
    skip,
  };
}
