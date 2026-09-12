/* هوک دارایی‌ها — فهرست + ارزشِ امروز، به‌همراهِ افزودن/ویرایش/حذف.

   چرا در AppProvider (بارِ سراسریِ بوت) نیست؟ ارزش‌گذاریِ این فهرست به
   قیمتِ بازار وابسته است و اگر کشِ سرور سرد باشد ممکن است کند شود. گذاشتنش
   در Promise.allِ بوت یعنی بالا آمدنِ کلِ اپ گروگانِ سرویسِ قیمت می‌شد؛
   این‌جا جدا و غیرمسدودکننده می‌آید و عددها بعداً می‌نشینند.

   کشِ ماژول-سطح هم عمداً نداریم (برخلافِ useMarket): قیمتِ بازار دادهٔ
   عمومی است ولی دارایی دادهٔ خانواده است — کشِ ماژولی پس از خروج زنده
   می‌ماند و دارایی‌های یک خانواده را به کاربرِ بعدیِ همان دستگاه نشان
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
  const { useCases } = useApp();
  const [data, setData] = useState<HoldingList>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /* پاسخِ دیرهنگام نباید روی کامپوننتِ جدا‌شده بنشیند */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!useCases) return;
    setLoading(true);
    setError(null);
    try {
      const next = await useCases.listHoldings.execute();
      if (alive.current) setData(next);
    } catch (e) {
      if (alive.current) {
        setError(e instanceof Error ? e.message : "خطا در دریافت دارایی‌ها");
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [useCases]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* هر سه عملیات پس از موفقیت فهرست را تازه می‌کنند: پاسخِ افزودن/ویرایش
     عمداً بی‌قیمت است (سرور برای یک ردیف فراخوانیِ جداگانهٔ بازار نمی‌زند)،
     پس اگر همان پاسخ را در state می‌نشاندیم، ردیفِ تازه «قیمت ندارد»
     نشان داده می‌شد. */
  const run = useCallback(
    async (op: () => Promise<unknown>, fallback: string): Promise<boolean> => {
      if (!useCases) return false;
      setBusy(true);
      setError(null);
      try {
        await op();
        await reload();
        return true;
      } catch (e) {
        if (alive.current) {
          setError(e instanceof Error ? e.message : fallback);
        }
        return false;
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [useCases, reload],
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

  return {
    items: data.items,
    total: data.total,
    unpriced: data.unpriced,
    stale: data.stale,
    loading,
    busy,
    error,
    clearError: () => setError(null),
    reload,
    add,
    update,
    remove,
  };
}

export type HoldingsModel = ReturnType<typeof useHoldings>;
