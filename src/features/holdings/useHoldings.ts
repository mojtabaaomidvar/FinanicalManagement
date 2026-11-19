/* هوک دارایی‌ها — فهرست + ارزش امروز، به‌همراه افزودن/ویرایش/حذف.

   چرا در AppProvider (بار سراسری بوت) نیست؟ ارزش‌گذاری این فهرست به
   قیمت بازار وابسته است و اگر کش سرور سرد باشد ممکن است کند شود. گذاشتنش
   در Promise.all بوت یعنی بالا آمدن کل اپ گروگان سرویس قیمت می‌شد؛
   این‌جا جدا و غیرمسدودکننده می‌آید و عددها بعداً می‌نشینند.

   کش ماژول-سطح هم عمداً نداریم (برخلاف useMarket): قیمت بازار دادهٔ
   عمومی است ولی دارایی دادهٔ خانواده است — کش ماژولی پس از خروج زنده
   می‌ماند و دارایی‌های یک خانواده را به کاربر بعدی همان دستگاه نشان
   می‌داد. */

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/app/providers/AppProvider";
import type {
  HoldingInput,
  HoldingList,
  HoldingPatch,
} from "@/domain/holding/holding.types";

const EMPTY: HoldingList = { items: [], total: 0, unpriced: 0, stale: false };

export function useHoldings() {
  const { useCases, family, member } = useApp();
  const scope = `${family?.id ?? ""}:${member?.id ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [data, setData] = useState<HoldingList>(EMPTY);
  const [dataScope, setDataScope] = useState(scope);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const reading = useRef(true);
  const readFailed = useRef(false);
  const requestId = useRef(0);
  const saving = useRef<symbol | null>(null);

  /* پاسخ دیرهنگام نباید روی کامپوننت جدا‌شده بنشیند */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!useCases) return false;
    const request = ++requestId.current;
    const active = () => alive.current && currentScope.current === scope && requestId.current === request;
    reading.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await useCases.listHoldings.execute();
      if (!active()) return false;
      setData(next);
      setDataScope(scope);
      readFailed.current = false;
      setRefreshFailed(false);
      return true;
    } catch (e) {
      if (active()) {
        readFailed.current = true;
        setLoadError(e instanceof Error ? e.message : "خطا در دریافت دارایی‌ها");
      }
      return false;
    } finally {
      if (active()) { reading.current = false; setLoading(false); }
    }
  }, [useCases, scope]);

  useEffect(() => {
    saving.current = null;
    readFailed.current = false;
    setBusy(false);
    setError(null);
    setRefreshFailed(false);
    void reload();
  }, [reload]);

  /* هر سه عملیات پس از موفقیت فهرست را تازه می‌کنند: پاسخ افزودن/ویرایش
     عمداً بی‌قیمت است (سرور برای یک ردیف فراخوانی جداگانهٔ بازار نمی‌زند)،
     پس اگر همان پاسخ را در state می‌نشاندیم، ردیف تازه «قیمت ندارد»
     نشان داده می‌شد. */
  const run = useCallback(
    async (op: () => Promise<unknown>, fallback: string): Promise<boolean> => {
      if (!useCases || saving.current || reading.current || readFailed.current) return false;
      const operation = Symbol("holding-write");
      saving.current = operation;
      const active = () => alive.current && currentScope.current === scope && saving.current === operation;
      setBusy(true);
      setError(null);
      try {
        await op();
        if (!active()) return false;
        const refreshed = await reload();
        if (!active()) return false;
        setRefreshFailed(!refreshed);
        return true;
      } catch (e) {
        if (active()) {
          setError(e instanceof Error ? e.message : fallback);
        }
        return false;
      } finally {
        if (active()) { saving.current = null; setBusy(false); }
      }
    },
    [useCases, reload, scope],
  );

  const add = useCallback(
    (input: HoldingInput) =>
      run(() => useCases!.addHolding.execute(input), "خطا در افزودن دارایی"),
    [run, useCases],
  );

  const update = useCallback(
    (patch: HoldingPatch) =>
      run(() => useCases!.updateHolding.execute(patch), "خطا در ویرایش دارایی"),
    [run, useCases],
  );

  const remove = useCallback(
    (id: string) =>
      run(() => useCases!.deleteHolding.execute(id), "خطا در حذف دارایی"),
    [run, useCases],
  );

  const visible = dataScope === scope ? data : EMPTY;
  return {
    items: visible.items,
    total: visible.total,
    unpriced: visible.unpriced,
    stale: visible.stale,
    loading,
    busy,
    locked: busy || loading || Boolean(loadError),
    isLocked: () => saving.current !== null || reading.current || readFailed.current,
    isSaving: () => saving.current !== null,
    error,
    loadError,
    refreshFailed,
    clearError: () => setError(null),
    reload,
    add,
    update,
    remove,
  };
}

export type HoldingsModel = ReturnType<typeof useHoldings>;
