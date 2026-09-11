/* اعمالِ پیش‌نویسِ قیفِ آغازین روی حسابِ تازه‌ساخته‌شده.

   واحدِ پول پیش از ورود پرسیده می‌شود، ولی تا وقتی عضوی وجود نداشته باشد
   جایی برای نوشتنش نیست. این هوک منتظر می‌ماند تا نشست آماده شود، بعد
   یک‌بار اعمال و پیش‌نویس را پاک می‌کند.

   عمداً «بی‌صدا» است: اگر نوشتن شکست بخورد کاربر را وسطِ ورود به اپ
   با خطا روبه‌رو نمی‌کنیم — واحدِ پول همیشه از تنظیمات قابلِ تغییر است. */

import { useEffect, useRef } from "react";
import { useApp } from "@/app/providers/AppProvider";
import { clearIntroDraft, readIntroDraft } from "./useOnboardingModel";

export function useApplyIntroDraft() {
  const { phase, member, useCases, updateMember } = useApp();
  const applied = useRef(false);

  useEffect(() => {
    if (phase !== "ready" || !member || !useCases || applied.current) return;
    const draft = readIntroDraft();
    if (!draft) return;

    applied.current = true;
    void (async () => {
      try {
        const current = member.currency === "ریال" ? "ریال" : "تومان";
        if (draft.currency !== current) {
          const updated = await useCases.setCurrency.execute(draft.currency);
          updateMember(updated);
        }
      } catch {
        /* بی‌صدا — از تنظیمات قابلِ اصلاح است */
      } finally {
        clearIntroDraft();
      }
    })();
  }, [phase, member, useCases, updateMember]);
}
