/* مدل دعوت — ساخت لینک، QR، کپی/اشتراک‌گذاری */

import { useEffect, useState } from "react";
import type { UseCases } from "@/application/useCases";

export function useInviteModel(useCases: UseCases, notify: (m: string) => void) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const token = await useCases.createInvite.execute();
      setLink(
        location.origin + location.pathname + "?invite=" + encodeURIComponent(token),
      );
      setOpen(true);
    } catch (e) {
      notify((e as Error).message || "خطا در ساخت لینک دعوت");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      notify("لینک کپی شد");
    } catch {
      notify("کپی ناموفق بود — لینک را دستی انتخاب کنید");
    }
  }

  async function share(familyName: string) {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "دعوت به خانه یار",
          text: `به خانواده «${familyName}» در اپ خانه یار بپیوندید:`,
          url: link,
        });
      } catch {
        /* لغو توسط کاربر */
      }
    } else {
      copy();
    }
  }

  /* رسم QR هنگام باز شدن مودال با لینک جدید */
  useEffect(() => {
    /* رسم در کامپوننت UI با canvas انجام می‌شود */
  }, [link]);

  return { open, setOpen, link, busy, create, copy, share };
}
