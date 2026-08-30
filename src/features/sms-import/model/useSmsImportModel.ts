/* مدل ورود پیامک — پارس زنده و ثبت دسته‌ای */

import { useMemo, useState } from "react";
import type { UseCases } from "@/application/useCases";
import { parseSms, splitSmsBlocks } from "@/shared/lib/sms-parser";
import { toFa } from "@/shared/lib/digits";

export function useSmsImportModel(useCases: UseCases, notify: (m: string) => void) {
  const [raw, setRaw] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const previews = useMemo(
    () =>
      splitSmsBlocks(raw).map((b) => {
        const p = parseSms(b);
        if (!p || !p.type || !p.amount) return { ok: false as const };
        return { ok: true as const, p };
      }),
    [raw],
  );

  async function save(onDone: () => void | Promise<void>) {
    if (!raw.trim()) return notify("متنی وارد نشده است");
    setBusy(true);
    try {
      const items = useCases.parseSmsImport.execute(raw);
      const added = items.length ? await useCases.addSmsBatch.execute(items) : 0;
      setOpen(false);
      setRaw("");
      notify(toFa(added) + " پیامک اضافه شد");
      if (added > 0) await onDone();
    } catch (e) {
      notify((e as Error).message || "خطا در ذخیره پیامک‌ها");
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    setOpen,
    raw,
    setRaw,
    previews,
    busy,
    save,
  };
}
