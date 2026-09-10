/* چسبِ اپ: خواندنِ نیتیوِ پیامک روی اندروید.
   وقتی کاربر لاگین است و پلاگین در دسترس است، مجوز می‌گیرد، به پیامک‌های ورودی گوش
   می‌دهد و هر متن را از مسیرِ ingestRawSms به مخزن می‌فرستد (سرور تصمیم می‌گیرد بانکی
   هست یا نه). روی وب/iOS بی‌صدا رد می‌شود؛ پلِ فورواردر همچنان فالبک است. */

import { useEffect } from "react";
import type { UseCases } from "@/application/useCases";
import type { PluginListenerHandle } from "@capacitor/core";
import { SmsReader, isSmsReaderAvailable } from "@/shared/native/smsReader";

export function useNativeSmsReader(
  enabled: boolean,
  useCases: UseCases | null,
  onIngested?: () => void,
): void {
  useEffect(() => {
    if (!enabled || !useCases) return;
    if (!isSmsReaderAvailable()) return;

    let cancelled = false;
    let handle: PluginListenerHandle | undefined;

    void (async () => {
      try {
        // مجوز: اگر داده نشده، یک‌بار می‌پرسیم؛ ردِ کاربر = بی‌صدا صرف‌نظر
        let perm = await SmsReader.checkPermissions();
        if (perm.sms !== "granted") {
          perm = await SmsReader.requestSmsPermission();
        }
        if (cancelled || perm.sms !== "granted") return;

        handle = await SmsReader.addListener("smsReceived", (ev) => {
          const text = (ev?.rawText ?? "").trim();
          if (!text) return;
          void useCases.ingestRawSms
            .execute(text, ev?.sender ?? null)
            .then((n) => {
              if (n > 0) onIngested?.();
            })
            .catch(() => {
              /* بی‌صدا؛ ثبتِ دستیِ پیامک همچنان کار می‌کند */
            });
        });

        if (cancelled) {
          void handle.remove();
          return;
        }
        await SmsReader.startWatching();
      } catch {
        /* پلاگین در دسترس نیست یا خطای نیتیو — نادیده */
      }
    })();

    return () => {
      cancelled = true;
      void SmsReader.stopWatching().catch(() => {});
      void handle?.remove();
    };
  }, [enabled, useCases, onIngested]);
}
