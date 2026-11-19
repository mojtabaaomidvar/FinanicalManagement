/* مدل ورود پیامک — پارس زنده و ثبت دسته‌ای */

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseCases } from "@/application/useCases";
import { parseSms, splitSmsBlocks } from "@/shared/lib/sms-parser";
import { toFa } from "@/shared/lib/digits";
import { smsAmountInToman } from "@/domain/sms/sms.rules";

import { readImportDraft, rememberImportDraft, type SmsDraftScope } from "@/features/pending-sms/model/smsDraftStorage";

export function useSmsImportModel(useCases: UseCases, notify: (m: string) => void, scope: SmsDraftScope) {
  const [raw, setRaw] = useState(() => readImportDraft(scope));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  useEffect(() => { setRaw(readImportDraft(scope)); setOpen(false); }, [scope.familyId, scope.memberId]);
  const previews = useMemo(
    () =>
      splitSmsBlocks(raw).map((b) => {
        const p = parseSms(b);
        if (!p?.type || !p.amount || !Number.isFinite(p.amount)) return { ok: false as const };
        return { ok: true as const, p, baseAmount: smsAmountInToman(b, p.amount) };
      }),
    [raw],
  );

  async function save(onDone: () => void | Promise<void>) {
    if (saving.current) return;
    if (!raw.trim()) return notify("متنی وارد نشده است");
    const items = useCases.parseSmsImport.execute(raw);
    if (!items.length) return notify("پیامک واریز یا برداشت با مبلغ معتبر پیدا نشد");
    saving.current = true;
    setBusy(true);
    try {
      const added = await useCases.addSmsBatch.execute(items);
      setOpen(false);
      setRaw("");
      rememberImportDraft(scope, "");
      notify(/* @copy-text sms.import.added */ `${toFa(added)} پیامک برای بررسی اضافه شد`);
      if (items.length < previews.length) notify("پیامک‌های تشخیص‌داده‌نشده اضافه نشدند");
      if (added > 0) {
        try { await onDone(); }
        catch { notify("پیامک‌ها اضافه شدند؛ دریافت فهرست تازه ناموفق بود"); }
      }
    } catch (e) {
      notify((e as Error).message || "خطا در ذخیره پیامک‌ها");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return {
    open,
    setOpen: (value: boolean) => { if (!saving.current) setOpen(value); },
    raw,
    setRaw: (value: string) => {
      if (saving.current) return;
      setRaw(value);
      if (!rememberImportDraft(scope, value)) notify("پیش‌نویس پیامک در این مرورگر ذخیره نشد؛ پیامک را به فهرست اضافه کنید.");
    },
    previews,
    busy,
    save,
  };
}
